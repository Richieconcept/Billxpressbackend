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

export const getMapleradInstitutions = async ({
  country = "NG",
  type = "DYNAMIC",
  page = 1,
  pageSize = 100,
} = {}) => {
  const normalizedType = String(type || "DYNAMIC").trim().toUpperCase();
  const supportedTypes = [
    "NUBAN",
    "MOMO",
    "WALLET",
    "VIRTUAL",
    "DYNAMIC",
    "CBK",
    "BOG",
    "MOMOCOLLECTION",
  ];

  if (!supportedTypes.includes(normalizedType)) {
    const error = new Error("Maplerad institution type is not supported");
    error.statusCode = 400;
    throw error;
  }

  const params = new URLSearchParams({
    country: String(country || "NG").trim().toUpperCase(),
    type: normalizedType,
    page: String(page || 1),
    page_size: String(pageSize || 100),
  });
  const response = await requestMaplerad(`/institutions?${params.toString()}`);
  const institutions = Array.isArray(response.data) ? response.data : [];

  return {
    country: params.get("country"),
    type: normalizedType,
    institutions: institutions.map((institution) => ({
      name: institution.name,
      code: institution.code,
      raw: institution,
    })),
    page: response.page,
    pageSize: response.page_size,
    total: response.total,
    providerResponse: response,
  };
};

export const createMapleradCustomer = async ({
  firstName,
  lastName,
  email,
  country = "NG",
}) =>
  requestMaplerad("/customers", {
    method: "POST",
    body: {
      first_name: firstName,
      last_name: lastName,
      email,
      country,
    },
  });

export const upgradeMapleradCustomerTier1 = async ({
  customerId,
  dob,
  identification_number,
  phone,
  address,
  photo,
}) => {
  const body = {
    customer_id: customerId,
    dob,
    identification_number,
    phone,
    address,
  };

  if (photo) {
    body.photo = photo;
  }

  return requestMaplerad("/customers/upgrade/tier1", {
    method: "PATCH",
    body,
  });
};

export const createMapleradVirtualAccount = async ({
  customerId,
  currency = "NGN",
}) => {
  const preferredBank = String(
    process.env.MAPLERAD_VIRTUAL_ACCOUNT_BANK_CODE || ""
  ).trim();
  const body = {
    customer_id: customerId,
    currency,
  };

  if (preferredBank) {
    body.preferred_bank = preferredBank;
  }

  const response = await requestMaplerad("/collections/virtual-account", {
    method: "POST",
    body,
  });
  const account = response.data || response;
  const accountNumber = pickFirst(account.account_number, account.accountNumber);
  const accountName = pickFirst(account.account_name, account.accountName);
  const bankName = pickFirst(account.bank_name, account.bankName);

  if (!accountNumber || !accountName || !bankName) {
    const error = new Error("Maplerad did not return virtual account details");
    error.statusCode = 502;
    error.providerResponse = response;
    throw error;
  }

  return {
    account: {
      providerAccountId: account.id,
      bankName,
      accountNumber,
      accountName,
      status: String(account.status || "active").toLowerCase(),
    },
    providerResponse: response,
  };
};

export const createMapleradDynamicAccount = async ({
  amountInMinorUnit,
  accountName,
}) => {
  const preferredBank = String(
    process.env.MAPLERAD_DYNAMIC_ACCOUNT_BANK_CODE || ""
  ).trim();
  const body = {
    account_name: accountName,
    amount: amountInMinorUnit,
  };

  if (preferredBank) {
    body.preferred_bank = preferredBank;
  }

  const response = await requestMaplerad("/collections/dynamic-account", {
    method: "POST",
    body,
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
