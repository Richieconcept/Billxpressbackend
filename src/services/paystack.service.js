const PAYSTACK_DEFAULT_BASE_URL = "https://api.paystack.co";

const getPaystackConfig = () => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  const baseUrl = process.env.PAYSTACK_BASE_URL || PAYSTACK_DEFAULT_BASE_URL;

  if (!secretKey) {
    const error = new Error("Paystack credentials are not configured");
    error.statusCode = 503;
    throw error;
  }

  return {
    secretKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
};

const requestPaystack = async (path, { method = "GET", body, headers = {} } = {}) => {
  const { baseUrl, secretKey } = getPaystackConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.status === false) {
    const error = new Error(data.message || "Paystack request failed");
    error.statusCode = response.status || 502;
    error.providerResponse = data;
    throw error;
  }

  return data;
};

export const getPaystackBanks = async ({
  country = "nigeria",
  currency = "NGN",
  perPage = 200,
} = {}) => {
  const params = new URLSearchParams({
    country,
    currency,
    perPage: String(perPage),
  });
  const response = await requestPaystack(`/bank?${params.toString()}`);
  const banks = Array.isArray(response.data) ? response.data : [];

  return banks.map((bank) => ({
    name: bank.name,
    code: bank.code,
    slug: bank.slug,
    type: bank.type,
    active: bank.active !== false,
    raw: bank,
  }));
};

export const resolvePaystackBankAccount = async ({ accountNumber, bankCode }) => {
  const normalizedAccountNumber = String(accountNumber || "").trim();
  const normalizedBankCode = String(bankCode || "").trim();

  if (!/^\d{10}$/.test(normalizedAccountNumber)) {
    const error = new Error("A valid 10 digit account number is required");
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedBankCode) {
    const error = new Error("Bank code is required");
    error.statusCode = 400;
    throw error;
  }

  const params = new URLSearchParams({
    account_number: normalizedAccountNumber,
    bank_code: normalizedBankCode,
  });
  const response = await requestPaystack(`/bank/resolve?${params.toString()}`);
  const account = response.data || {};

  if (!account.account_name) {
    const error = new Error("Could not resolve account name");
    error.statusCode = 404;
    error.providerResponse = response;
    throw error;
  }

  return {
    accountNumber: account.account_number || normalizedAccountNumber,
    accountName: account.account_name,
    bankCode: normalizedBankCode,
    provider: "paystack",
  };
};
