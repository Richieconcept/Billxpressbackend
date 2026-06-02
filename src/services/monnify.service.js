const MONNIFY_DEFAULT_BASE_URL = "https://api.monnify.com";

const getMonnifyConfig = () => {
  const apiKey = process.env.MONNIFY_API_KEY;
  const secretKey = process.env.MONNIFY_SECRET_KEY;
  const contractCode = process.env.MONNIFY_CONTRACT_CODE;
  const baseUrl = process.env.MONNIFY_BASE_URL || MONNIFY_DEFAULT_BASE_URL;

  if (!apiKey || !secretKey) {
    const error = new Error("Monnify credentials are not configured");
    error.statusCode = 503;
    throw error;
  }

  if (!contractCode) {
    const error = new Error("MONNIFY_CONTRACT_CODE is not configured");
    error.statusCode = 503;
    throw error;
  }

  return {
    apiKey,
    secretKey,
    contractCode,
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
};

const requestMonnify = async (path, { method = "GET", body, token } = {}) => {
  const { baseUrl } = getMonnifyConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.requestSuccessful === false) {
    const error = new Error(data.responseMessage || "Monnify request failed");
    error.statusCode = response.status || 502;
    error.providerResponse = data;
    throw error;
  }

  return data;
};

const authenticateMonnify = async () => {
  const { apiKey, secretKey, baseUrl } = getMonnifyConfig();
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString(
        "base64"
      )}`,
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.requestSuccessful === false) {
    const error = new Error(data.responseMessage || "Monnify auth failed");
    error.statusCode = response.status || 502;
    error.providerResponse = data;
    throw error;
  }

  const token = data.responseBody?.accessToken;

  if (!token) {
    const error = new Error("Monnify did not return an access token");
    error.statusCode = 502;
    error.providerResponse = data;
    throw error;
  }

  return token;
};

const getResponseBody = (response) => response.responseBody || response.data || response;

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

export const createMonnifyTransferIntent = async ({
  amount,
  customerName,
  customerEmail,
  paymentReference,
}) => {
  const { contractCode } = getMonnifyConfig();
  const token = await authenticateMonnify();
  const initBody = {
    amount,
    currencyCode: "NGN",
    contractCode,
    customerName,
    customerEmail,
    paymentReference,
    paymentDescription: "Billxpress wallet funding",
    paymentMethods: ["ACCOUNT_TRANSFER"],
  };
  const initResponse = await requestMonnify(
    "/api/v1/merchant/transactions/init-transaction",
    {
      method: "POST",
      token,
      body: initBody,
    }
  );
  const init = getResponseBody(initResponse);
  const transactionReference =
    init.transactionReference || init.transaction_reference || paymentReference;
  const bankTransferBody = {
    transactionReference,
  };

  if (process.env.MONNIFY_BANK_CODE) {
    bankTransferBody.bankCode = process.env.MONNIFY_BANK_CODE;
  }

  const transferResponse = await requestMonnify(
    "/api/v1/merchant/bank-transfer/init-payment",
    {
      method: "POST",
      token,
      body: bankTransferBody,
    }
  );
  const transfer = getResponseBody(transferResponse);
  const accountNumber = pickFirst(
    transfer.accountNumber,
    transfer.account_number,
    transfer.account?.accountNumber,
    transfer.bankAccount?.accountNumber
  );
  const accountName = pickFirst(
    transfer.accountName,
    transfer.account_name,
    transfer.account?.accountName,
    transfer.bankAccount?.accountName
  );
  const bankName = pickFirst(
    transfer.bankName,
    transfer.bank_name,
    transfer.account?.bankName,
    transfer.bankAccount?.bankName
  );

  if (!accountNumber || !accountName || !bankName) {
    const error = new Error("Monnify did not return transfer account details");
    error.statusCode = 502;
    error.providerResponse = transferResponse;
    throw error;
  }

  return {
    transactionReference,
    paymentReference,
    accountNumber,
    accountName,
    bankName,
    bankCode: transfer.bankCode || transfer.bank_code || process.env.MONNIFY_BANK_CODE,
    providerResponse: {
      init: initResponse,
      transfer: transferResponse,
    },
  };
};

export const getMonnifyTransactionStatus = async (transactionReference) => {
  if (!transactionReference) {
    const error = new Error("Monnify transaction reference is required");
    error.statusCode = 400;
    throw error;
  }

  const token = await authenticateMonnify();
  const response = await requestMonnify(
    `/api/v2/transactions/${encodeURIComponent(transactionReference)}`,
    {
      token,
    }
  );

  return getResponseBody(response);
};
