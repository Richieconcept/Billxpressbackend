const PROVIDER = "vtpass";

const NETWORKS = [
  { code: "MTN", name: "MTN", serviceID: "mtn", available: true },
  { code: "AIRTEL", name: "Airtel", serviceID: "airtel", available: true },
  { code: "GLO", name: "Glo", serviceID: "glo", available: true },
  { code: "9MOBILE", name: "9mobile", serviceID: "etisalat", available: true },
];

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

export const getSupportedNetworks = () =>
  NETWORKS.map(({ code, name, available }) => ({ code, name, available }));

export const purchaseAirtime = async ({ network, phone, amount, reference }) => {
  const networkConfig = NETWORKS.find((item) => item.code === network);

  if (!networkConfig) {
    const error = new Error("Selected VTpass airtime network is not supported");
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    request_id: toLagosRequestId(reference),
    serviceID: networkConfig.serviceID,
    amount: Number(amount),
    phone,
  };
  const response = await requestVtpass("/pay", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!isSuccessfulPurchase(response)) {
    const error = new Error(
      response?.response_description ||
        response?.message ||
        "VTpass airtime purchase failed"
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
    message: response.response_description || "Airtime purchase successful",
    raw: response,
    requestPayload: payload,
  };
};

export default {
  name: PROVIDER,
  getSupportedNetworks,
  purchaseAirtime,
};
