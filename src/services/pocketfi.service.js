const POCKETFI_DEFAULT_BASE_URL = "https://api.pocketfi.ng";

export const POCKETFI_ALLOWED_VIRTUAL_ACCOUNT_BANKS = ["paga", "kuda"];

const getPocketFiConfig = () => {
  const apiKey = process.env.POCKETFI_API_KEY || process.env.POCKETFI_PUBLIC_KEY;
  const secretKey = process.env.POCKETFI_SECRET_KEY;
  const businessId = process.env.POCKETFI_BUSINESS_ID;
  const baseUrl = process.env.POCKETFI_BASE_URL || POCKETFI_DEFAULT_BASE_URL;

  if (!apiKey && !secretKey) {
    const error = new Error("POCKETFI_API_KEY is not configured");
    error.statusCode = 503;
    throw error;
  }

  if (!businessId) {
    const error = new Error("POCKETFI_BUSINESS_ID is not configured");
    error.statusCode = 503;
    throw error;
  }

  return {
    apiKey: apiKey || secretKey,
    secretKey,
    businessId,
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
};

const requestPocketFi = async (path, { method = "GET", body } = {}) => {
  const { apiKey, baseUrl } = getPocketFiConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.status === false || data.status === "error") {
    const error = new Error(data.message || "PocketFi request failed");
    error.statusCode = response.status || 502;
    error.providerResponse = data;
    throw error;
  }

  return data;
};

const normalizePocketFiPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");

  if (/^0\d{10}$/.test(digits)) {
    return digits;
  }

  if (/^234\d{10}$/.test(digits)) {
    return `0${digits.slice(3)}`;
  }

  const error = new Error("Phone number must be 11 digits");
  error.statusCode = 400;
  throw error;
};

export const createPocketFiVirtualAccount = async ({
  firstName,
  lastName,
  phone,
  email,
  bank,
  nin,
  bvn,
}) => {
  const { businessId } = getPocketFiConfig();
  const normalizedBank = String(bank || "paga").trim().toLowerCase();

  if (!POCKETFI_ALLOWED_VIRTUAL_ACCOUNT_BANKS.includes(normalizedBank)) {
    const error = new Error(
      `Bank must be one of: ${POCKETFI_ALLOWED_VIRTUAL_ACCOUNT_BANKS.join(", ")}`
    );
    error.statusCode = 400;
    throw error;
  }

  const body = {
    first_name: firstName,
    last_name: lastName,
    phone: normalizePocketFiPhone(phone),
    email,
    businessId,
    bank: normalizedBank,
  };

  if (nin) {
    body.nin = nin;
  }

  if (bvn) {
    body.bvn = bvn;
  }

  return requestPocketFi("/api/v1/virtual-accounts/create", {
    method: "POST",
    body,
  });
};

export const createPocketFiVirtualAccounts = async ({
  banks = POCKETFI_ALLOWED_VIRTUAL_ACCOUNT_BANKS,
  allowEmpty = false,
  ...payload
}) => {
  const accounts = [];
  const errors = [];

  for (const bank of banks) {
    try {
      const response = await createPocketFiVirtualAccount({
        ...payload,
        bank,
      });
      accounts.push({ bank, response });
    } catch (error) {
      errors.push({
        provider: "pocketfi",
        bank,
        message: error.message,
        statusCode: error.statusCode,
        providerResponse: error.providerResponse,
      });
    }
  }

  if (accounts.length === 0 && !allowEmpty) {
    const error = new Error("Could not create PocketFi virtual account");
    error.statusCode = 502;
    error.providerErrors = errors;
    throw error;
  }

  return { accounts, errors };
};
