const MAPLERAD_DEFAULT_BASE_URL = "https://api.maplerad.com/v1";

const getMapleradConfig = () => {
  const secretKey = process.env.MAPLERAD_SECRET_KEY;
  const baseUrl = process.env.MAPLERAD_BASE_URL || MAPLERAD_DEFAULT_BASE_URL;

  if (!secretKey) {
    const error = new Error("Maplerad credentials are not configured");
    error.statusCode = 503;
    throw error;
  }

  return {
    secretKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
};

const requestMaplerad = async (path, { method = "GET", body, headers = {} } = {}) => {
  const { baseUrl, secretKey } = getMapleradConfig();
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
    const error = new Error(data.message || "Maplerad request failed");
    error.statusCode = response.status || 502;
    error.providerResponse = data;
    throw error;
  }

  return data;
};

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

export const createMapleradDynamicAccount = async ({
  amountInMinorUnit,
  accountName,
}) => {
  const preferredBank = process.env.MAPLERAD_DYNAMIC_ACCOUNT_BANK_CODE;

  if (!preferredBank) {
    const error = new Error("MAPLERAD_DYNAMIC_ACCOUNT_BANK_CODE is not configured");
    error.statusCode = 503;
    throw error;
  }

  const response = await requestMaplerad("/collections/dynamic-account", {
    method: "POST",
    body: {
      account_name: accountName,
      amount: amountInMinorUnit,
      preferred_bank: preferredBank,
    },
  });
  const account = response.data || response;
  const accountNumber = pickFirst(
    account.account_number,
    account.accountNumber,
    account.account?.account_number,
    account.account?.accountNumber
  );
  const returnedAccountName = pickFirst(
    account.account_name,
    account.accountName,
    account.account?.account_name,
    account.account?.accountName
  );
  const bankName = pickFirst(
    account.bank_name,
    account.bankName,
    account.account?.bank_name,
    account.account?.bankName
  );

  if (!accountNumber || !returnedAccountName || !bankName) {
    const error = new Error("Maplerad did not return dynamic account details");
    error.statusCode = 502;
    error.providerResponse = response;
    throw error;
  }

  return {
    providerReference: pickFirst(account.id, account.reference, accountNumber),
    paymentReference: pickFirst(account.reference, account.id, accountNumber),
    accountNumber,
    accountName: returnedAccountName,
    bankName,
    bankCode: pickFirst(account.bank_code, account.bankCode, preferredBank),
    providerResponse: response,
  };
};
