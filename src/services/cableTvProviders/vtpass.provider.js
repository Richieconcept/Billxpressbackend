const PROVIDER = "vtpass";

const TV_PROVIDERS = [
  {
    code: "DSTV",
    name: "DSTV",
    serviceID: "dstv",
    supportsSubscriptionType: true,
  },
  {
    code: "GOTV",
    name: "GOtv",
    serviceID: "gotv",
    supportsSubscriptionType: true,
  },
  {
    code: "STARTIMES",
    name: "Startimes",
    serviceID: "startimes",
    supportsSubscriptionType: false,
  },
].map((provider) => ({ ...provider, available: true }));

const getBaseUrl = () =>
  String(process.env.VTPASS_BASE_URL || "https://vtpass.com/api")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\/+$/, "");

const getVtpassConfig = () => {
  const apiKey = process.env.VTPASS_API_KEY;
  const secretKey = process.env.VTPASS_SECRET_KEY;

  if (!apiKey || !secretKey) {
    const error = new Error("VTpass credentials are not configured");
    error.statusCode = 503;
    throw error;
  }

  return { apiKey, secretKey };
};

const toLagosRequestId = (reference) => {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const prefix = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
  ].join("");
  const suffix = String(reference || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-18);

  return `${prefix}${suffix || Math.random().toString(36).slice(2, 10)}`;
};

const requestVtpass = async (path, options = {}) => {
  const { apiKey, secretKey } = getVtpassConfig();
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "api-key": apiKey,
      "secret-key": secretKey,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(
      data?.response_description || data?.message || "VTpass request failed"
    );
    error.statusCode = 502;
    error.providerResponse = data;
    throw error;
  }

  return data;
};

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const getTvProvider = (tvProvider) =>
  TV_PROVIDERS.find(
    (item) => item.code === String(tvProvider || "").trim().toUpperCase()
  );

const getTransaction = (response) => response?.content?.transactions || {};

const isSuccessfulPurchase = (response) => {
  const code = String(response?.code || "");
  const description = String(response?.response_description || "").toLowerCase();
  const status = String(getTransaction(response)?.status || "").toLowerCase();

  return (
    code === "000" ||
    description.includes("transaction successful") ||
    status === "delivered"
  );
};

const normalizePackage = (item) => ({
  code: String(item.variation_code || item.code || "").trim(),
  name: String(item.name || item.package || "").trim(),
  amount: Number(item.variation_amount || item.amount || item.price || 0),
  fixedPrice:
    item.fixedPrice === "Yes" ||
    item.fixedPrice === true ||
    item.fixed_price === true,
  raw: item,
});

export const getSupportedTvProviders = () =>
  TV_PROVIDERS.map(
    ({ code, name, serviceID, available, supportsSubscriptionType }) => ({
      code,
      name,
      serviceID,
      available,
      supportsSubscriptionType,
      subscriptionTypes: supportsSubscriptionType
        ? [
            { code: "change", name: "Change Package" },
            { code: "renew", name: "Renew Package" },
          ]
        : [],
    })
  );

export const getPackages = async ({ tvProvider }) => {
  const providerConfig = getTvProvider(tvProvider);

  if (!providerConfig) {
    const error = new Error("Selected cable TV provider is not supported");
    error.statusCode = 400;
    throw error;
  }

  const params = new URLSearchParams({ serviceID: providerConfig.serviceID });
  const response = await requestVtpass(`/service-variations?${params.toString()}`);
  const content = response.content || response.data || response;
  const variations = Array.isArray(content.varations)
    ? content.varations
    : Array.isArray(content.variations)
      ? content.variations
      : [];
  const packages = variations
    .map(normalizePackage)
    .filter((item) => item.code && item.name && Number.isFinite(item.amount));

  return {
    provider: PROVIDER,
    tvProvider: {
      code: providerConfig.code,
      name: providerConfig.name,
      serviceID: providerConfig.serviceID,
    },
    packages,
    raw: response,
  };
};

export const verifySmartcard = async ({ tvProvider, smartcardNumber }) => {
  const providerConfig = getTvProvider(tvProvider);
  const normalizedSmartcardNumber = String(smartcardNumber || "").trim();

  if (!providerConfig) {
    const error = new Error("Selected cable TV provider is not supported");
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedSmartcardNumber) {
    const error = new Error("Smartcard number is required");
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    serviceID: providerConfig.serviceID,
    billersCode: normalizedSmartcardNumber,
  };
  const response = await requestVtpass("/merchant-verify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const content = response.content || response.data || response;
  const customerName = pickFirst(
    content.Customer_Name,
    content.customerName,
    content.customer_name,
    content.name
  );

  if (!customerName) {
    const error = new Error("Could not verify smartcard details");
    error.statusCode = 404;
    error.providerResponse = response;
    throw error;
  }

  return {
    provider: PROVIDER,
    tvProvider: {
      code: providerConfig.code,
      name: providerConfig.name,
      serviceID: providerConfig.serviceID,
    },
    smartcardNumber: normalizedSmartcardNumber,
    customerName,
    currentBouquet: pickFirst(
      content.Current_Bouquet,
      content.currentBouquet,
      content.current_bouquet
    ),
    dueDate: pickFirst(content.Due_Date, content.dueDate, content.due_date),
    raw: response,
    requestPayload: payload,
  };
};

export const purchaseCableTv = async ({
  tvProvider,
  smartcardNumber,
  packageCode,
  packageAmount,
  phone,
  subscriptionType = "change",
  reference,
}) => {
  const providerConfig = getTvProvider(tvProvider);

  if (!providerConfig) {
    const error = new Error("Selected cable TV provider is not supported");
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    request_id: toLagosRequestId(reference),
    serviceID: providerConfig.serviceID,
    billersCode: String(smartcardNumber || "").trim(),
    variation_code: String(packageCode || "").trim(),
    amount: Number(packageAmount),
    phone: String(phone || "").trim(),
  };

  if (providerConfig.supportsSubscriptionType) {
    payload.subscription_type = ["change", "renew"].includes(subscriptionType)
      ? subscriptionType
      : "change";
  }

  const response = await requestVtpass("/pay", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!isSuccessfulPurchase(response)) {
    const error = new Error(
      response?.response_description ||
        response?.message ||
        "VTpass cable TV purchase failed"
    );
    error.statusCode = 502;
    error.providerResponse = response;
    throw error;
  }

  const transaction = getTransaction(response);

  return {
    provider: PROVIDER,
    providerReference:
      transaction.transactionId || response.requestId || payload.request_id,
    message: response.response_description || "Cable TV purchase successful",
    raw: response,
    requestPayload: payload,
  };
};

export default {
  name: PROVIDER,
  getSupportedTvProviders,
  getPackages,
  verifySmartcard,
  purchaseCableTv,
};
