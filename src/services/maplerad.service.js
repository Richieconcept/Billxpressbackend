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

export const requestMaplerad = async (
  path,
  { method = "GET", body, headers = {} } = {}
) => {
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

const isPreferredBankFailure = (error) => {
  const message = String(
    error?.providerResponse?.message || error?.message || ""
  ).toLowerCase();

  return message.includes("preferred bank");
};

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

export const resolveMapleradInstitutionAccount = async ({
  accountNumber,
  bankCode,
}) => {
  const normalizedAccountNumber = String(accountNumber || "").trim();
  const normalizedBankCode = String(bankCode || "").trim();

  if (!/^\d{10}$/.test(normalizedAccountNumber)) {
    const error = new Error("A valid 10 digit account number is required");
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedBankCode) {
    const error = new Error("Maplerad bank code is required");
    error.statusCode = 400;
    throw error;
  }

  const requestPayload = {
    account_number: normalizedAccountNumber,
    bank_code: normalizedBankCode,
  };
  const response = await requestMaplerad("/institutions/resolve", {
    method: "POST",
    body: requestPayload,
  });
  const account = response.data || response;
  const accountName = pickFirst(
    account.account_name,
    account.accountName,
    account.name,
    account.account?.account_name,
    account.account?.accountName
  );

  if (!accountName) {
    const error = new Error("Could not resolve account name");
    error.statusCode = 404;
    error.providerResponse = response;
    throw error;
  }

  return {
    accountNumber: pickFirst(
      account.account_number,
      account.accountNumber,
      account.account?.account_number,
      account.account?.accountNumber,
      normalizedAccountNumber
    ),
    accountName,
    bankCode: normalizedBankCode,
    provider: "maplerad",
    requestPayload,
    providerResponse: response,
  };
};

export const verifyMapleradTransaction = (transactionId) => {
  const normalizedTransactionId = String(transactionId || "").trim();

  if (!normalizedTransactionId) {
    const error = new Error("Maplerad transaction ID is required");
    error.statusCode = 400;
    throw error;
  }

  return requestMaplerad(
    `/transactions/verify/${encodeURIComponent(normalizedTransactionId)}`
  );
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

  let response;
  let bankSelection = preferredBank ? "preferred" : "default";
  let preferredBankError;

  try {
    response = await requestMaplerad("/collections/dynamic-account", {
      method: "POST",
      body,
    });
  } catch (error) {
    if (!preferredBank || !isPreferredBankFailure(error)) {
      throw error;
    }

    preferredBankError = error.providerResponse || { message: error.message };
    bankSelection = "default";
    response = await requestMaplerad("/collections/dynamic-account", {
      method: "POST",
      body: {
        account_name: accountName,
        amount: amountInMinorUnit,
      },
    });
  }

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
    providerResponse: {
      ...response,
      bankSelection,
      preferredBank,
      preferredBankError,
    },
  };
};

export const createMapleradLocalTransfer = async ({
  amountInMinorUnit,
  accountNumber,
  bankCode,
  reference,
  reason,
  currency = "NGN",
}) => {
  const normalizedAccountNumber = String(accountNumber || "").trim();
  const normalizedBankCode = String(bankCode || "").trim();

  if (!/^\d{10}$/.test(normalizedAccountNumber)) {
    const error = new Error("A valid 10 digit account number is required");
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedBankCode) {
    const error = new Error("Maplerad bank code is required");
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isInteger(amountInMinorUnit) || amountInMinorUnit <= 0) {
    const error = new Error("Transfer amount must be greater than zero");
    error.statusCode = 400;
    throw error;
  }

  const requestPayload = {
    bank_code: normalizedBankCode,
    account_number: normalizedAccountNumber,
    amount: amountInMinorUnit,
    currency,
    reference,
  };

  if (reason) {
    requestPayload.reason = reason;
  }

  const transferPath = process.env.MAPLERAD_TRANSFER_PATH || "/transfers";
  const response = await requestMaplerad(transferPath, {
    method: "POST",
    body: requestPayload,
  });
  const transfer = response.data || response;

  return {
    providerReference: pickFirst(
      transfer.id,
      transfer.reference,
      response.id,
      response.reference,
      reference
    ),
    status: String(
      pickFirst(transfer.status, response.status, "PENDING")
    ).toUpperCase(),
    requestPayload,
    providerResponse: response,
  };
};

export const generateMapleradFxQuote = async ({
  sourceCurrency,
  targetCurrency,
  amountInMinorUnit,
}) => {
  if (!Number.isInteger(amountInMinorUnit) || amountInMinorUnit <= 0) {
    const error = new Error("FX quote amount must be greater than zero");
    error.statusCode = 400;
    throw error;
  }

  const response = await requestMaplerad("/fx/quote", {
    method: "POST",
    body: {
      source_currency: String(sourceCurrency || "").toUpperCase(),
      target_currency: String(targetCurrency || "").toUpperCase(),
      amount: amountInMinorUnit,
    },
  });
  const quote = response.data || response;

  if (
    !quote.reference ||
    !Number.isInteger(Number(quote.source?.amount)) ||
    !Number.isInteger(Number(quote.target?.amount))
  ) {
    const error = new Error("Maplerad returned an invalid FX quote");
    error.statusCode = 502;
    error.providerResponse = response;
    throw error;
  }

  return {
    reference: quote.reference,
    sourceCurrency: quote.source.currency,
    sourceAmount: Number(quote.source.amount),
    targetCurrency: quote.target.currency,
    targetAmount: Number(quote.target.amount),
    rate: Number(quote.rate) || 0,
    providerResponse: response,
  };
};

export const exchangeMapleradCurrency = async (quoteReference) =>
  requestMaplerad("/fx", {
    method: "POST",
    body: {
      quote_reference: quoteReference,
    },
  });

export const createMapleradCard = async ({
  customerId,
  brand,
  amountInMinorUnit,
}) => {
  const body = {
    customer_id: customerId,
    currency: "USD",
    type: "VIRTUAL",
    auto_approve: true,
    brand,
    is_contactless: false,
  };

  if (Number.isInteger(amountInMinorUnit) && amountInMinorUnit > 0) {
    body.amount = amountInMinorUnit;
  }

  const response = await requestMaplerad("/issuing", {
    method: "POST",
    body,
  });
  const cardRequest = response.data || response;
  const providerCard = cardRequest.card || cardRequest;
  const reference = pickFirst(
    cardRequest.reference,
    response.reference,
    providerCard.reference,
    providerCard.id
  );
  const providerCardId = pickFirst(
    providerCard.id,
    cardRequest.card_id,
    response.card_id
  );

  if (!reference) {
    const error = new Error("Maplerad did not return a card creation reference");
    error.statusCode = 502;
    error.providerResponse = response;
    throw error;
  }

  return {
    reference,
    providerCard,
    providerCardId,
    providerResponse: response,
  };
};

export const getMapleradCard = (cardId) =>
  requestMaplerad(`/issuing/${encodeURIComponent(cardId)}`);

export const getMapleradCardTransactions = (
  cardId,
  { page = 1, pageSize = 20, startDate, endDate } = {}
) => {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });

  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);

  return requestMaplerad(
    `/issuing/${encodeURIComponent(cardId)}/transactions?${params.toString()}`
  );
};

export const fundMapleradCard = (cardId, amountInMinorUnit) =>
  requestMaplerad(`/issuing/${encodeURIComponent(cardId)}/fund`, {
    method: "POST",
    body: { amount: amountInMinorUnit },
  });

export const withdrawMapleradCard = (cardId, amountInMinorUnit) =>
  requestMaplerad(`/issuing/${encodeURIComponent(cardId)}/withdraw`, {
    method: "POST",
    body: { amount: amountInMinorUnit },
  });

export const freezeMapleradCard = (cardId) =>
  requestMaplerad(`/issuing/${encodeURIComponent(cardId)}/freeze`, {
    method: "PATCH",
  });

export const unfreezeMapleradCard = (cardId) =>
  requestMaplerad(`/issuing/${encodeURIComponent(cardId)}/unfreeze`, {
    method: "PATCH",
  });
