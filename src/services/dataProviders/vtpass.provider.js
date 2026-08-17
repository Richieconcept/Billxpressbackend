const PROVIDER = "vtpass";

const NETWORKS = [
  { code: "MTN", name: "MTN", serviceID: "mtn-data" },
  { code: "AIRTEL", name: "Airtel", serviceID: "airtel-data" },
  { code: "GLO", name: "Glo", serviceID: "glo-data" },
  { code: "9MOBILE", name: "9mobile", serviceID: "etisalat-data" },
];

let planCache = {
  expiresAt: 0,
  plans: [],
};

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
    error.isFinalProviderFailure =
      response.status >= 400 && response.status < 500;
    throw error;
  }

  return data;
};

const toNumber = (value) => {
  const number = Number(String(value ?? "").replace(/[,\s]/g, ""));

  return Number.isFinite(number) ? number : 0;
};

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const getTransaction = (response) => response?.content?.transactions || {};

const getVariations = (response) => {
  const content = response.content || response.data || response;

  if (Array.isArray(content.variations)) return content.variations;
  if (Array.isArray(content.varations)) return content.varations;
  if (Array.isArray(content)) return content;

  return [];
};

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

const isPendingPurchase = (response) => {
  const text = [
    response?.code,
    response?.response_description,
    response?.message,
    getTransaction(response)?.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(pending|processing|queued|initiated|in progress|timeout|timedout|timed out)\b/.test(
    text
  );
};

const isConfirmedFailureResponse = (response) => {
  const text = [
    response?.code,
    response?.response_description,
    response?.message,
    getTransaction(response)?.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    /\b(failed|fail|declined|rejected|cancelled|canceled)\b/.test(text) ||
    /\b(invalid|incorrect|not available|unavailable|disabled|does not exist)\b/.test(
      text
    ) ||
    /\b(insufficient|low|fund wallet|out of funds|balance)\b/.test(text)
  );
};

const parseValidityDays = (name) => {
  const match = String(name || "").match(/(\d+)\s*(day|days|hr|hrs|hour|hours)/i);

  if (!match) return 0;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (unit.startsWith("hr") || unit.startsWith("hour")) {
    return value >= 24 ? Math.ceil(value / 24) : 1;
  }

  return value;
};

const inferDataType = (name, serviceID) => {
  const text = `${serviceID} ${name}`.toUpperCase();

  if (text.includes("SME")) return "SME";
  if (text.includes("CORPORATE")) return "CORPORATE";
  if (text.includes("GIFT")) return "GIFTING";
  if (text.includes("AWOOF")) return "AWOOF";

  return "VTU";
};

const getPlanCacheTtlMs = () => {
  const seconds = Number(process.env.VTPASS_PLAN_CACHE_TTL_SECONDS || 300);

  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 300000;
};

const fetchPlansForNetwork = async (network) => {
  const params = new URLSearchParams({ serviceID: network.serviceID });
  const response = await requestVtpass(`/service-variations?${params.toString()}`);

  return getVariations(response).map((plan) => {
    const amount = toNumber(
      pickFirst(plan.variation_amount, plan.amount, plan.price)
    );
    const code = String(pickFirst(plan.variation_code, plan.code, "")).trim();
    const name = String(pickFirst(plan.name, plan.package, code)).trim();

    return {
      provider: PROVIDER,
      providerPlanId: code,
      providerPlanCode: code,
      network: network.code,
      networkCode: network.serviceID,
      name,
      type: inferDataType(name, network.serviceID),
      providerDataType: network.serviceID,
      validity: name,
      validityDays: parseValidityDays(name),
      networkPrice: amount,
      providerPrice: amount,
      costPrice: amount,
      available: amount > 0 && Boolean(code),
      raw: {
        ...plan,
        network: network.code,
        serviceID: network.serviceID,
      },
    };
  });
};

export const fetchPlans = async ({ forceRefresh = false } = {}) => {
  if (!forceRefresh && planCache.expiresAt > Date.now()) {
    return planCache.plans;
  }

  const planGroups = await Promise.all(NETWORKS.map(fetchPlansForNetwork));
  const plans = planGroups
    .flat()
    .filter((plan) => plan.providerPlanId && plan.network && plan.costPrice > 0);

  planCache = {
    expiresAt: Date.now() + getPlanCacheTtlMs(),
    plans,
  };

  return plans;
};

export const purchaseData = async ({ plan, phone, reference }) => {
  const serviceID = String(plan.networkCode || plan.raw?.serviceID || "");
  const payload = {
    request_id: toLagosRequestId(reference),
    serviceID,
    billersCode: String(phone || "").trim(),
    variation_code: String(plan.providerPlanCode || plan.providerPlanId || ""),
    amount: Number(plan.providerPrice || plan.costPrice || 0),
    phone: String(phone || "").trim(),
  };
  const response = await requestVtpass("/pay", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!isSuccessfulPurchase(response)) {
    const error = new Error(
      response?.response_description ||
        response?.message ||
        "VTpass data purchase failed"
    );
    error.statusCode = 502;
    error.providerResponse = response;
    error.isProviderPending = isPendingPurchase(response);
    error.isFinalProviderFailure =
      !error.isProviderPending && isConfirmedFailureResponse(response);
    throw error;
  }

  const transaction = getTransaction(response);

  return {
    provider: PROVIDER,
    providerReference:
      response.requestId || payload.request_id || transaction.transactionId,
    message: response.response_description || "Data purchase successful",
    raw: response,
    requestPayload: payload,
  };
};

export const checkTransactionStatus = (providerReference) =>
  requestVtpass("/requery", {
    method: "POST",
    body: JSON.stringify({ request_id: providerReference }),
  });

export default {
  name: PROVIDER,
  fetchPlans,
  purchaseData,
  checkTransactionStatus,
};
