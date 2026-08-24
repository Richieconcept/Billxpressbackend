const FLUTTERWAVE_DEFAULT_BASE_URL = "https://api.flutterwave.com";

const getFlutterwaveConfig = () => {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  const baseUrl =
    process.env.FLUTTERWAVE_BASE_URL || FLUTTERWAVE_DEFAULT_BASE_URL;

  if (!secretKey) {
    const error = new Error("Flutterwave credentials are not configured");
    error.statusCode = 503;
    throw error;
  }

  return {
    secretKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
};

const requestFlutterwave = async (path, { method = "GET", body } = {}) => {
  const { secretKey, baseUrl } = getFlutterwaveConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${secretKey}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || String(data.status || "").toLowerCase() === "error") {
    const error = new Error(
      data.message || data.error || "Flutterwave request failed"
    );
    error.statusCode = response.status || 502;
    error.providerResponse = data;
    throw error;
  }

  return data;
};

const getResponseData = (response) => response.data || response;

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const getFundingExpiryMinutes = () => {
  const minutes = Number(
    process.env.FLUTTERWAVE_FUNDING_EXPIRES_MINUTES ||
      process.env.ONE_TIME_FUNDING_EXPIRES_MINUTES ||
      15
  );

  return Number.isFinite(minutes) && minutes > 0 ? minutes : 15;
};

export const createFlutterwaveDynamicAccount = async ({
  amount,
  customerName,
  customerEmail,
  paymentReference,
}) => {
  const body = {
    email: customerEmail,
    amount,
    currency: "NGN",
    tx_ref: paymentReference,
    is_permanent: false,
    narration: customerName || "BillXpress wallet funding",
    expiry: getFundingExpiryMinutes(),
    ...(process.env.FLUTTERWAVE_BANK_CODE
      ? { bank_code: process.env.FLUTTERWAVE_BANK_CODE }
      : {}),
  };
  const response = await requestFlutterwave("/v3/virtual-account-numbers", {
    method: "POST",
    body,
  });
  const data = getResponseData(response);
  const accountNumber = pickFirst(
    data.account_number,
    data.accountNumber,
    data.account?.account_number,
    data.account?.accountNumber
  );
  const accountName = pickFirst(
    data.account_name,
    data.accountName,
    data.narration,
    customerName
  );
  const bankName = pickFirst(
    data.bank_name,
    data.bankName,
    data.account_bank_name,
    data.accountBankName,
    data.account?.bank_name,
    data.account?.bankName
  );
  const providerReference = pickFirst(
    data.flw_ref,
    data.flwRef,
    data.order_ref,
    data.orderRef,
    data.id,
    accountNumber,
    paymentReference
  );
  const expiresAt = pickFirst(
    data.expiry_date,
    data.expiryDate,
    data.account_expiration_datetime,
    data.accountExpirationDatetime,
    data.expires_at,
    data.expiresAt
  );

  if (!accountNumber || !accountName || !bankName) {
    const error = new Error("Flutterwave did not return virtual account details");
    error.statusCode = 502;
    error.providerResponse = response;
    throw error;
  }

  return {
    providerReference,
    paymentReference,
    accountNumber,
    accountName,
    bankName,
    bankCode: pickFirst(data.bank_code, data.bankCode),
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    providerResponse: response,
  };
};

export const verifyFlutterwaveTransaction = async (transactionId) => {
  if (!transactionId) {
    const error = new Error("Flutterwave transaction ID is required");
    error.statusCode = 400;
    throw error;
  }

  const response = await requestFlutterwave(
    `/v3/transactions/${encodeURIComponent(transactionId)}/verify`
  );

  return getResponseData(response);
};
