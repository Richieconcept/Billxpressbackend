import VirtualAccount from "../models/virtualAccount.model.js";
import {
  POCKETFI_ALLOWED_VIRTUAL_ACCOUNT_BANKS,
  createPocketFiVirtualAccounts,
} from "./pocketfi.service.js";
import { serializeFundingFee } from "./fundingFee.service.js";

const formatPocketFiAccountName = (accountName) => {
  const normalizedAccountName = String(accountName || "").trim();

  if (!normalizedAccountName) {
    return normalizedAccountName;
  }

  if (/\bbillxpress\b/i.test(normalizedAccountName)) {
    return normalizedAccountName;
  }

  return `${normalizedAccountName} (BillXpress)`;
};

const formatAccountName = ({ provider, accountName }) => {
  if (provider === "pocketfi") {
    return formatPocketFiAccountName(accountName);
  }

  return accountName;
};

export const serializeVirtualAccount = async (virtualAccount) => ({
  id: virtualAccount._id,
  provider: virtualAccount.provider,
  bankName: virtualAccount.bankName,
  accountNumber: virtualAccount.accountNumber,
  accountName: formatAccountName({
    provider: virtualAccount.provider,
    accountName: virtualAccount.accountName,
  }),
  accounts:
    virtualAccount.provider === "maplerad"
      ? [
          {
            provider: virtualAccount.provider,
            bankName: virtualAccount.bankName,
            accountNumber: virtualAccount.accountNumber,
            accountName: virtualAccount.accountName,
            status: virtualAccount.status,
            createdAt: virtualAccount.updatedAt || virtualAccount.createdAt,
          },
        ]
      : virtualAccount.accounts?.map((account) => ({
          provider: account.provider || virtualAccount.provider,
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          accountName: formatAccountName({
            provider: account.provider || virtualAccount.provider,
            accountName: account.accountName,
          }),
          status: account.status,
          createdAt: account.createdAt,
        })) || [],
  providerErrors: virtualAccount.providerErrors || [],
  feePolicy: await serializeFundingFee("pocketfi"),
  status: virtualAccount.status,
  createdAt: virtualAccount.createdAt,
});

const normalizePocketFiAccount = ({ response }) => {
  const bank = response.banks?.[0];

  if (!bank?.accountNumber || !bank?.bankName || !bank?.accountName) {
    const error = new Error("PocketFi did not return virtual account details");
    error.statusCode = 502;
    error.providerResponse = response;
    throw error;
  }

  return {
    bankName: String(bank.bankName).toLowerCase(),
    provider: "pocketfi",
    accountNumber: bank.accountNumber,
    accountName: bank.accountName,
    status: "active",
    providerResponse: response,
  };
};

const bankOrderIndex = (bankName) => {
  const index = POCKETFI_ALLOWED_VIRTUAL_ACCOUNT_BANKS.indexOf(
    String(bankName || "").toLowerCase()
  );

  return index === -1 ? POCKETFI_ALLOWED_VIRTUAL_ACCOUNT_BANKS.length : index;
};

export const getOrCreateVirtualAccountForUser = async (user) => {
  const existingVirtualAccount = await VirtualAccount.findOne({
    user: user._id,
  });

  const existingBanks = new Set(
    [
      existingVirtualAccount?.bankName,
      ...(existingVirtualAccount?.accounts || []).map(
        (account) => account.bankName
      ),
    ]
      .filter(Boolean)
      .map((bankName) => bankName.toLowerCase())
  );
  const missingBanks = POCKETFI_ALLOWED_VIRTUAL_ACCOUNT_BANKS.filter(
    (bank) => !existingBanks.has(bank)
  );

  if (existingVirtualAccount && missingBanks.length === 0) {
    return {
      virtualAccount: existingVirtualAccount,
      created: false,
      providerErrors: existingVirtualAccount.providerErrors || [],
    };
  }

  const { accounts, errors } = await createPocketFiVirtualAccounts({
    banks: missingBanks,
    allowEmpty: Boolean(existingVirtualAccount),
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    email: user.email,
    nin: user.nin,
    bvn: user.bvn,
  });
  const normalizedAccounts = accounts.map(({ response }) =>
    normalizePocketFiAccount({ response })
  );

  if (normalizedAccounts.length === 0 && existingVirtualAccount) {
    existingVirtualAccount.providerErrors = errors;
    await existingVirtualAccount.save();

    return {
      virtualAccount: existingVirtualAccount,
      created: false,
      providerErrors: errors,
    };
  }

  const virtualAccount =
    existingVirtualAccount ||
    new VirtualAccount({
      user: user._id,
      businessId: String(process.env.POCKETFI_BUSINESS_ID),
    });

  const legacyAccount =
    virtualAccount.bankName &&
    virtualAccount.accountNumber &&
    virtualAccount.accountName
      ? {
          bankName: virtualAccount.bankName,
          provider: virtualAccount.provider || "pocketfi",
          accountNumber: virtualAccount.accountNumber,
          accountName: virtualAccount.accountName,
          status: virtualAccount.status || "active",
          providerResponse: virtualAccount.providerResponse || {},
          createdAt: virtualAccount.createdAt,
        }
      : null;
  const currentAccounts = [
    ...(virtualAccount.accounts || []),
    ...(legacyAccount ? [legacyAccount] : []),
  ];
  const mergedAccounts = [
    ...currentAccounts.filter(
      (account, index, list) =>
        index ===
        list.findIndex(
          (item) =>
            item.bankName?.toLowerCase() === account.bankName?.toLowerCase()
        )
    ),
    ...normalizedAccounts.filter(
      (newAccount) =>
        !currentAccounts.some(
          (existingAccount) =>
            existingAccount.bankName?.toLowerCase() ===
            newAccount.bankName.toLowerCase()
        )
    ),
  ];
  const sortedAccounts = mergedAccounts.sort(
    (a, b) => bankOrderIndex(a.bankName) - bankOrderIndex(b.bankName)
  );
  const primaryAccount =
    sortedAccounts.find(
      (account) => String(account.bankName).toLowerCase() === "paga"
    ) || sortedAccounts[0];

  virtualAccount.provider = "pocketfi";
  virtualAccount.businessId = String(
    primaryAccount.providerResponse?.businessId ||
      virtualAccount.businessId ||
      process.env.POCKETFI_BUSINESS_ID
  );
  virtualAccount.bankName = primaryAccount.bankName;
  virtualAccount.accountNumber = primaryAccount.accountNumber;
  virtualAccount.accountName = primaryAccount.accountName;
  virtualAccount.displayName = undefined;
  virtualAccount.providerResponse = primaryAccount.providerResponse;
  virtualAccount.accounts = sortedAccounts;
  virtualAccount.providerErrors = errors;
  await virtualAccount.save();

  return {
    virtualAccount,
    created: !existingVirtualAccount,
    providerErrors: errors,
  };
};

export const addMapleradVirtualAccountForUser = async ({
  user,
  account,
  providerResponse,
}) => {
  const existingVirtualAccount = await VirtualAccount.findOne({
    user: user._id,
  });
  const virtualAccount =
    existingVirtualAccount ||
    new VirtualAccount({
      user: user._id,
      businessId: "maplerad",
    });
  const normalizedAccount = {
    provider: "maplerad",
    providerAccountId: account.providerAccountId,
    bankName: account.bankName,
    accountNumber: account.accountNumber,
    accountName: account.accountName,
    status: account.status === "pending" ? "inactive" : "active",
    providerResponse,
    createdAt: new Date(),
  };
  const legacyPrimaryAccount =
    virtualAccount.provider &&
    virtualAccount.provider !== "maplerad" &&
    virtualAccount.bankName &&
    virtualAccount.accountNumber &&
    virtualAccount.accountName
      ? {
          provider: virtualAccount.provider,
          bankName: virtualAccount.bankName,
          accountNumber: virtualAccount.accountNumber,
          accountName: virtualAccount.accountName,
          status: virtualAccount.status || "active",
          providerResponse: virtualAccount.providerResponse || {},
          createdAt: virtualAccount.createdAt || new Date(),
        }
      : null;
  const currentAccounts = [
    ...(virtualAccount.accounts || []),
    ...(legacyPrimaryAccount ? [legacyPrimaryAccount] : []),
  ];
  const accounts = [
    ...currentAccounts.filter(
      (existingAccount) =>
        !(
          existingAccount.provider === "maplerad" ||
          existingAccount.accountNumber === normalizedAccount.accountNumber
        )
    ),
    normalizedAccount,
  ];

  virtualAccount.provider = "maplerad";
  virtualAccount.businessId = "maplerad";
  virtualAccount.bankName = normalizedAccount.bankName;
  virtualAccount.accountNumber = normalizedAccount.accountNumber;
  virtualAccount.accountName = normalizedAccount.accountName;
  virtualAccount.displayName = undefined;
  virtualAccount.providerResponse = providerResponse;
  virtualAccount.accounts = accounts;
  virtualAccount.status = normalizedAccount.status;
  await virtualAccount.save();

  return virtualAccount;
};
