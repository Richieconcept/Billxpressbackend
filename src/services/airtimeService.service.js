import AirtimeServiceSetting from "../models/airtimeServiceSetting.model.js";
import User from "../models/user.model.js";
import {
  creditWallet,
  debitWallet,
  generateTransactionReference,
  serializeTransaction,
  serializeWallet,
  toMinorUnit,
  verifyTransactionPin,
} from "./wallet.service.js";
import {
  createNotificationBestEffort,
  notifyAdminsOfServiceFailureBestEffort,
} from "./notification.service.js";
import {
  getAirtimeProvider,
  listAirtimeProviders,
} from "./airtimeProviders/index.js";
import { getPublicProviderFailure } from "./providerFailure.service.js";
import { withServicePurchaseLock } from "./servicePurchaseLock.service.js";
import { ensureUniqueCustomerReference } from "./vendorReference.service.js";

const getMarkupPercentForUser = (settings, user) =>
  user.role === "vendor" && user.isVendorActive
    ? settings.vendorMarkupPercent
    : settings.userMarkupPercent;

const roundSellingPrice = (amount, roundingMode) => {
  if (roundingMode === "round") {
    return Math.round(amount);
  }

  return Math.ceil(amount);
};

const calculateSellingPrice = ({ amount, markupPercent, roundingMode }) => {
  const sellingPrice = roundSellingPrice(
    amount + amount * (markupPercent / 100),
    roundingMode
  );

  return {
    sellingPrice,
    profit: Math.max(0, sellingPrice - amount),
  };
};

export const getOrCreateAirtimeServiceSetting = async () => {
  let settings = await AirtimeServiceSetting.findOne({ service: "airtime" });

  if (!settings) {
    settings = await AirtimeServiceSetting.create({ service: "airtime" });
  }

  return settings;
};

export const serializeAirtimeServiceSetting = (settings) => ({
  id: settings._id,
  service: settings.service,
  isEnabled: settings.isEnabled,
  activeProvider: settings.activeProvider,
  availableProviders: listAirtimeProviders(),
  userMarkupPercent: settings.userMarkupPercent,
  vendorMarkupPercent: settings.vendorMarkupPercent,
  roundingMode: settings.roundingMode,
  minimumAmount: settings.minimumAmount,
  maximumAmount: settings.maximumAmount,
  updatedBy: settings.updatedBy,
  createdAt: settings.createdAt,
  updatedAt: settings.updatedAt,
});

export const updateAirtimeServiceSetting = async (payload, adminUserId) => {
  const settings = await getOrCreateAirtimeServiceSetting();
  const allowedFields = [
    "isEnabled",
    "activeProvider",
    "userMarkupPercent",
    "vendorMarkupPercent",
    "roundingMode",
    "minimumAmount",
    "maximumAmount",
  ];

  allowedFields.forEach((field) => {
    if (payload[field] !== undefined) {
      settings[field] = payload[field];
    }
  });

  settings.updatedBy = adminUserId;
  await settings.save();

  return settings;
};

export const getAirtimeNetworksForUser = async (user) => {
  const settings = await getOrCreateAirtimeServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Airtime service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getAirtimeProvider(settings.activeProvider);

  return {
    settings,
    provider: provider.name,
    networks: provider.getSupportedNetworks(),
    appliedMarkupPercent: getMarkupPercentForUser(settings, user),
  };
};

export const quoteAirtimeForUser = async ({ user, amount }) => {
  const settings = await getOrCreateAirtimeServiceSetting();
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    const error = new Error("Amount must be greater than zero");
    error.statusCode = 400;
    throw error;
  }

  if (numericAmount < settings.minimumAmount) {
    const error = new Error(`Minimum airtime amount is ${settings.minimumAmount}`);
    error.statusCode = 400;
    throw error;
  }

  if (numericAmount > settings.maximumAmount) {
    const error = new Error(`Maximum airtime amount is ${settings.maximumAmount}`);
    error.statusCode = 400;
    throw error;
  }

  const markupPercent = getMarkupPercentForUser(settings, user);
  const pricing = calculateSellingPrice({
    amount: numericAmount,
    markupPercent,
    roundingMode: settings.roundingMode,
  });

  return {
    amount: numericAmount,
    sellingPrice: pricing.sellingPrice,
    profit: pricing.profit,
    markupPercent,
    roundingMode: settings.roundingMode,
  };
};

const purchaseAirtimeForUserUnlocked = async ({
  userId,
  network,
  phone,
  amount,
  transactionPin,
  customerReference,
  requireTransactionPin = true,
}) => {
  const normalizedNetwork = String(network || "").trim().toUpperCase();
  const normalizedPhone = String(phone || "").trim();

  if (
    !normalizedNetwork ||
    !normalizedPhone ||
    !amount ||
    (requireTransactionPin && !transactionPin)
  ) {
    const error = new Error(
      "Network, phone number, amount, and transaction PIN are required"
    );
    error.statusCode = 400;
    throw error;
  }

  if (!/^0\d{10}$/.test(normalizedPhone)) {
    const error = new Error("Phone number must be 11 digits and start with 0");
    error.statusCode = 400;
    throw error;
  }

  const user = await User.findById(userId).select("+transactionPin");

  if (!user || !user.isActive) {
    const error = new Error("User account is not active");
    error.statusCode = 401;
    throw error;
  }

  if (requireTransactionPin) {
    await verifyTransactionPin(user, transactionPin);
  }

  const normalizedCustomerReference = await ensureUniqueCustomerReference({
    userId: user._id,
    customerReference,
  });

  const settings = await getOrCreateAirtimeServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Airtime service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getAirtimeProvider(settings.activeProvider);
  const networkConfig = provider
    .getSupportedNetworks()
    .find((item) => item.code === normalizedNetwork);

  if (!networkConfig || !networkConfig.available) {
    const error = new Error("Selected airtime network is not available");
    error.statusCode = 404;
    throw error;
  }

  const quote = await quoteAirtimeForUser({ user, amount });
  const amountInMinorUnit = toMinorUnit(quote.sellingPrice);
  const reference = generateTransactionReference("AIRTIME");
  const debitResult = await debitWallet({
    userId: user._id,
    amountInMinorUnit,
    walletType: "main",
    type: "service_payment",
    reference,
    provider: provider.name,
    narration: `Airtime purchase: ${normalizedNetwork} NGN ${quote.amount}`,
    metadata: {
      service: "airtime",
      network: normalizedNetwork,
      phone: normalizedPhone,
      amount: quote.amount,
      sellingPrice: quote.sellingPrice,
      profit: quote.profit,
      markupPercent: quote.markupPercent,
      customerReference: normalizedCustomerReference || undefined,
    },
  });

  try {
    const providerResult = await provider.purchaseAirtime({
      network: normalizedNetwork,
      phone: normalizedPhone,
      amount: quote.amount,
      reference,
    });

    debitResult.transaction.providerReference = providerResult.providerReference;
    debitResult.transaction.metadata = {
      ...debitResult.transaction.metadata,
      providerRequest: providerResult.requestPayload,
      providerResponse: providerResult.raw,
    };
    await debitResult.transaction.save();

    await createNotificationBestEffort({
      userId: user._id,
      title: "Airtime purchase successful",
      message: `${normalizedNetwork} airtime purchase of NGN ${quote.amount} for ${normalizedPhone} was successful.`,
      type: "service_purchase_success",
      channel: "both",
      priority: "normal",
      data: {
        service: "airtime",
        network: normalizedNetwork,
        phone: normalizedPhone,
        amount: quote.sellingPrice,
        airtimeValue: quote.amount,
        reference,
        provider: provider.name,
        providerReference: providerResult.providerReference,
      },
    });

    return {
      status: "successful",
      message: providerResult.message,
      quote,
      network: networkConfig,
      wallet: debitResult.wallet,
      transaction: debitResult.transaction,
      providerResponse: providerResult.raw,
    };
  } catch (error) {
    const publicFailure = getPublicProviderFailure(error, "Airtime purchase");

    debitResult.transaction.status = "reversed";
    debitResult.transaction.metadata = {
      ...debitResult.transaction.metadata,
      providerError: error.providerResponse || error.message,
      publicError: publicFailure,
    };
    await debitResult.transaction.save();

    const refundResult = await creditWallet({
      userId: user._id,
      amountInMinorUnit,
      walletType: "main",
      type: "reversal",
      reference: `${reference}_REV`,
      provider: provider.name,
      narration: `Refund for failed airtime purchase: ${normalizedNetwork} NGN ${quote.amount}`,
      metadata: {
        service: "airtime",
        originalReference: reference,
        reason: publicFailure.message,
        providerFailureCode: publicFailure.code,
      },
    });

    await createNotificationBestEffort({
      userId: user._id,
      title: "Airtime purchase failed",
      message: publicFailure.message,
      type: "service_purchase_failed",
      channel: "both",
      priority: "normal",
      data: {
        service: "airtime",
        network: normalizedNetwork,
        phone: normalizedPhone,
        amount: quote.sellingPrice,
        airtimeValue: quote.amount,
        reference,
        refundReference: refundResult.transaction.reference,
        provider: provider.name,
        failureCode: publicFailure.code,
      },
    });

    await notifyAdminsOfServiceFailureBestEffort({
      user,
      service: "airtime",
      amount: quote.sellingPrice,
      reference,
      provider: provider.name,
      providerReference: debitResult.transaction.providerReference,
      failureCode: publicFailure.code,
      transactionId: debitResult.transaction._id,
      data: {
        network: normalizedNetwork,
        phone: normalizedPhone,
        airtimeValue: quote.amount,
        refundReference: refundResult.transaction.reference,
      },
    });

    error.message = publicFailure.message;
    error.statusCode = publicFailure.statusCode;
    error.code = publicFailure.code;
    error.wallet = refundResult.wallet;
    error.transaction = debitResult.transaction;
    error.refundTransaction = refundResult.transaction;
    throw error;
  }
};

export const purchaseAirtimeForUser = (payload) =>
  withServicePurchaseLock({
    userId: payload.userId,
    service: "airtime",
    operation: () => purchaseAirtimeForUserUnlocked(payload),
  });

export const serializeAirtimePurchaseResult = (result) => ({
  status: result.status,
  message: result.message,
  network: result.network,
  quote: result.quote,
  wallet: serializeWallet(result.wallet),
  transaction: serializeTransaction(result.transaction),
  providerResponse:
    process.env.NODE_ENV === "production" ? undefined : result.providerResponse,
});

export const serializeFailedAirtimePurchase = (error) => ({
  message: error.message,
  code: error.code,
  wallet: error.wallet ? serializeWallet(error.wallet) : undefined,
  transaction: error.transaction
    ? serializeTransaction(error.transaction)
    : undefined,
  refundTransaction: error.refundTransaction
    ? serializeTransaction(error.refundTransaction)
    : undefined,
  providerResponse:
    process.env.NODE_ENV === "production" ? undefined : error.providerResponse,
});
