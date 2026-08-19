const PROVIDER = "vtpass";

const DISCOS = [
  { code: "IKEDC", name: "Ikeja Electric", serviceID: "ikeja-electric" },
  { code: "EKEDC", name: "Eko Electric", serviceID: "eko-electric" },
  { code: "KEDCO", name: "Kano Electric", serviceID: "kano-electric" },
  {
    code: "PHED",
    name: "Port Harcourt Electric",
    serviceID: "portharcourt-electric",
  },
  { code: "JED", name: "Jos Electric", serviceID: "jos-electric" },
  { code: "IBEDC", name: "Ibadan Electric", serviceID: "ibadan-electric" },
  { code: "KAEDCO", name: "Kaduna Electric", serviceID: "kaduna-electric" },
  { code: "AEDC", name: "Abuja Electric", serviceID: "abuja-electric" },
  { code: "EEDC", name: "Enugu Electric", serviceID: "enugu-electric" },
  { code: "BEDC", name: "Benin Electric", serviceID: "benin-electric" },
  { code: "ABA", name: "ABA Electric", serviceID: "aba-electric" },
  { code: "YEDC", name: "Yola Electric", serviceID: "yola-electric" },
].map((disco) => ({
  ...disco,
  available: true,
  meterTypes: [
    { code: "prepaid", name: "Prepaid" },
    { code: "postpaid", name: "Postpaid" },
  ],
}));

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

const normalizeMeterType = (meterType) =>
  String(meterType || "").trim().toLowerCase();

const getDisco = (disco) =>
  DISCOS.find((item) => item.code === String(disco || "").trim().toUpperCase());

const getTransaction = (response) => response?.content?.transactions || {};

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const getProviderMessage = (response, fallback) =>
  pickFirst(
    response?.response_description,
    response?.message,
    response?.content?.error,
    response?.content?.message,
    fallback
  );

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

export const getSupportedDiscos = () =>
  DISCOS.map(({ code, name, available, meterTypes }) => ({
    code,
    name,
    available,
    meterTypes,
  }));

export const verifyMeter = async ({ disco, meterNumber, meterType }) => {
  const discoConfig = getDisco(disco);
  const normalizedMeterNumber = String(meterNumber || "").trim();
  const normalizedMeterType = normalizeMeterType(meterType);

  if (!discoConfig) {
    const error = new Error("Selected electricity provider is not supported");
    error.statusCode = 400;
    throw error;
  }

  if (!["prepaid", "postpaid"].includes(normalizedMeterType)) {
    const error = new Error("Meter type must be prepaid or postpaid");
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedMeterNumber) {
    const error = new Error("Meter number is required");
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    serviceID: discoConfig.serviceID,
    billersCode: normalizedMeterNumber,
    type: normalizedMeterType,
  };
  const response = await requestVtpass("/merchant-verify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const content = response.content || response.data || response;

  if (String(response?.code || "") !== "000") {
    const error = new Error(
      getProviderMessage(
        response,
        "The meter number could not be verified. Please check the meter number, disco, and meter type, then try again"
      )
    );
    error.statusCode = 400;
    error.providerResponse = response;
    throw error;
  }

  const customerName = pickFirst(
    content.Customer_Name,
    content.customerName,
    content.customer_name,
    content.name
  );

  if (!customerName) {
    const error = new Error(
      getProviderMessage(
        response,
        "The meter number could not be verified. Please check the meter number, disco, and meter type, then try again"
      )
    );
    error.statusCode = 404;
    error.providerResponse = response;
    throw error;
  }

  return {
    provider: PROVIDER,
    disco: {
      code: discoConfig.code,
      name: discoConfig.name,
      serviceID: discoConfig.serviceID,
    },
    meterNumber: pickFirst(
      content.Meter_Number,
      content.meterNumber,
      content.meter_number,
      normalizedMeterNumber
    ),
    meterType: normalizedMeterType,
    customerName,
    address: pickFirst(content.Address, content.address),
    minimumAmount: Number(
      pickFirst(
        content.Minimum_Amount,
        content.Min_Purchase_Amount,
        content.minimumAmount,
        content.minimum_amount,
        content.minPurchaseAmount,
        content.min_purchase_amount,
        0
      )
    ),
    raw: response,
    requestPayload: payload,
  };
};

export const purchaseElectricity = async ({
  disco,
  meterNumber,
  meterType,
  phone,
  amount,
  reference,
}) => {
  const discoConfig = getDisco(disco);
  const normalizedMeterType = normalizeMeterType(meterType);

  if (!discoConfig) {
    const error = new Error("Selected electricity provider is not supported");
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    request_id: toLagosRequestId(reference),
    serviceID: discoConfig.serviceID,
    billersCode: String(meterNumber || "").trim(),
    variation_code: normalizedMeterType,
    amount: Number(amount),
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
        "VTpass electricity purchase failed"
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
    token: pickFirst(
      response?.purchased_code,
      response?.token,
      response?.content?.token,
      transaction.purchased_code
    ),
    units: pickFirst(response?.units, response?.content?.units, transaction.units),
    message: response.response_description || "Electricity purchase successful",
    raw: response,
    requestPayload: payload,
  };
};

export default {
  name: PROVIDER,
  getSupportedDiscos,
  verifyMeter,
  purchaseElectricity,
};
