const PROVIDER = "ujaydata";

const getBaseUrl = () =>
  (process.env.UJAYDATA_BASE_URL || "https://ujaydata.com.ng/api").replace(
    /\/+$/,
    ""
  );

const requestUjayData = async (path, options = {}) => {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(process.env.UJAYDATA_API_KEY
      ? { Authorization: `Token ${process.env.UJAYDATA_API_KEY}` }
      : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(
      data?.message || data?.msg || "UjayData request failed"
    );
    error.statusCode = 502;
    error.providerResponse = data;
    throw error;
  }

  return data;
};

const isSuccessfulPurchase = (response) => {
  const status = String(response?.status || response?.Status || "").toLowerCase();
  const message = String(
    response?.message || response?.msg || response?.description || ""
  ).toLowerCase();

  return status === "success" || status === "successful" || message.includes("successful");
};

const DEFAULT_NETWORK_CODES = {
  MTN: "1",
  GLO: "2",
  "9MOBILE": "3",
  AIRTEL: "4",
};

const getAirtimeNetworkCode = (network) => {
  const normalizedNetwork = String(network || "").trim().toUpperCase();
  const envKey = `UJAYDATA_AIRTIME_${normalizedNetwork}_NETWORK_CODE`;

  return process.env[envKey] || DEFAULT_NETWORK_CODES[normalizedNetwork] || network;
};

export const getSupportedNetworks = () => [
  { code: "MTN", name: "MTN", available: true },
  { code: "AIRTEL", name: "Airtel", available: true },
  { code: "GLO", name: "Glo", available: true },
  { code: "9MOBILE", name: "9mobile", available: true },
];

export const purchaseAirtime = async ({ network, phone, amount, reference }) => {
  const payload = {
    network: String(getAirtimeNetworkCode(network)),
    phone,
    amount: String(amount),
  };
  const response = await requestUjayData("/airtime/", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!isSuccessfulPurchase(response)) {
    const error = new Error(
      response?.message || response?.msg || "Airtime purchase failed"
    );
    error.statusCode = 502;
    error.providerResponse = response;
    throw error;
  }

  return {
    provider: PROVIDER,
    providerReference:
      response.transaction_id ||
      response.transactionId ||
      response.reference ||
      response.Ref ||
      reference,
    message:
      response.message ||
      response.description ||
      response.api_response ||
      "Airtime purchase successful",
    raw: response,
    requestPayload: payload,
  };
};

export default {
  name: PROVIDER,
  getSupportedNetworks,
  purchaseAirtime,
};
