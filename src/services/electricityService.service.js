import ElectricityServiceSetting from "../models/electricityServiceSetting.model.js";
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
  getElectricityProvider,
  listElectricityProviders,
} from "./electricityProviders/index.js";
import { getPublicProviderFailure } from "./providerFailure.service.js";
import { withServicePurchaseLock } from "./servicePurchaseLock.service.js";
import { ensureUniqueCustomerReference } from "./vendorReference.service.js";

const ELECTRICITY_SERVICE_TEMPORARILY_DISABLED = true;
const ELECTRICITY_SERVICE_DISABLED_MESSAGE =
  "Electricity service is currently unavailable";

const ensureElectricityServiceAvailable = (settings) => {
  if (ELECTRICITY_SERVICE_TEMPORARILY_DISABLED || !settings.isEnabled) {
    const error = new Error(ELECTRICITY_SERVICE_DISABLED_MESSAGE);
    error.statusCode = 503;
    throw error;
  }
};

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

export const getOrCreateElectricityServiceSetting = async () => {
  let settings = await ElectricityServiceSetting.findOne({
    service: "electricity",
  });

  if (!settings) {
    settings = await ElectricityServiceSetting.create({
      service: "electricity",
    });
  }

  return settings;
};

export const serializeElectricityServiceSetting = (settings) => ({
  id: settings._id,
  service: settings.service,
  isEnabled: ELECTRICITY_SERVICE_TEMPORARILY_DISABLED
    ? false
    : settings.isEnabled,
  activeProvider: settings.activeProvider,
  availableProviders: listElectricityProviders(),
  userMarkupPercent: settings.userMarkupPercent,
  vendorMarkupPercent: settings.vendorMarkupPercent,
  roundingMode: settings.roundingMode,
  minimumAmount: settings.minimumAmount,
  maximumAmount: settings.maximumAmount,
  updatedBy: settings.updatedBy,
  createdAt: settings.createdAt,
  updatedAt: settings.updatedAt,
});

export const updateElectricityServiceSetting = async (payload, adminUserId) => {
  const settings = await getOrCreateElectricityServiceSetting();
  const source =
    payload && typeof payload === "object" && payload.settings
      ? payload.settings
      : payload || {};
  const allowedFields = [
    "isEnabled",
    "activeProvider",
    "userMarkupPercent",
    "vendorMarkupPercent",
    "roundingMode",
    "minimumAmount",
    "maximumAmount",
  ];
  const receivedFields = allowedFields.filter((field) => source[field] !== undefined);

  if (receivedFields.length === 0) {
    const error = new Error(
      "No valid electricity service settings were provided. Send JSON fields like activeProvider, userMarkupPercent, or minimumAmount."
    );
    error.statusCode = 400;
    throw error;
  }

  receivedFields.forEach((field) => {
    if (
      [
        "userMarkupPercent",
        "vendorMarkupPercent",
        "minimumAmount",
        "maximumAmount",
      ].includes(field)
    ) {
      settings[field] = Number(source[field]);
    } else if (field === "isEnabled") {
      settings[field] =
        typeof source[field] === "string"
          ? source[field].toLowerCase() === "true"
          : source[field];
    } else {
      settings[field] = source[field];
    }
  });

  settings.updatedBy = adminUserId;
  await settings.save();

  return settings;
};

export const getElectricityDiscosForUser = async (user) => {
  const settings = await getOrCreateElectricityServiceSetting();

  ensureElectricityServiceAvailable(settings);

  const provider = getElectricityProvider(settings.activeProvider);

  return {
    settings,
    provider: provider.name,
    discos: provider.getSupportedDiscos(),
    appliedMarkupPercent: getMarkupPercentForUser(settings, user),
  };
};

export const quoteElectricityForUser = async ({ user, amount }) => {
  const settings = await getOrCreateElectricityServiceSetting();
  ensureElectricityServiceAvailable(settings);

  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    const error = new Error("Amount must be greater than zero");
    error.statusCode = 400;
    throw error;
  }

  if (numericAmount < settings.minimumAmount) {
    const error = new Error(
      `Minimum electricity amount is ${settings.minimumAmount}`
    );
    error.statusCode = 400;
    throw error;
  }

  if (numericAmount > settings.maximumAmount) {
    const error = new Error(
      `Maximum electricity amount is ${settings.maximumAmount}`
    );
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

export const verifyElectricityMeterForUser = async ({
  user,
  disco,
  meterNumber,
  meterType,
}) => {
  const settings = await getOrCreateElectricityServiceSetting();

  ensureElectricityServiceAvailable(settings);

  const provider = getElectricityProvider(settings.activeProvider);

  return provider.verifyMeter({ disco, meterNumber, meterType });
};

const purchaseElectricityForUserUnlocked = async ({
  userId,
  disco,
  meterNumber,
  meterType,
  phone,
  amount,
  transactionPin,
  customerReference,
  requireTransactionPin = true,
}) => {
  const normalizedDisco = String(disco || "").trim().toUpperCase();
  const normalizedMeterNumber = String(meterNumber || "").trim();
  const normalizedMeterType = String(meterType || "").trim().toLowerCase();
  const normalizedPhone = String(phone || "").trim();

  if (
    !normalizedDisco ||
    !normalizedMeterNumber ||
    !normalizedMeterType ||
    !normalizedPhone ||
    !amount ||
    (requireTransactionPin && !transactionPin)
  ) {
    const error = new Error(
      "Disco, meter number, meter type, phone, amount, and transaction PIN are required"
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

  const settings = await getOrCreateElectricityServiceSetting();

  ensureElectricityServiceAvailable(settings);

  const provider = getElectricityProvider(settings.activeProvider);
  const verifiedMeter = await provider.verifyMeter({
    disco: normalizedDisco,
    meterNumber: normalizedMeterNumber,
    meterType: normalizedMeterType,
  });
  const providerMinimumAmount = Number(verifiedMeter.minimumAmount || 0);

  if (
    providerMinimumAmount > 0 &&
    Number(amount) < providerMinimumAmount
  ) {
    const error = new Error(
      `Minimum electricity amount for this meter is NGN ${providerMinimumAmount.toLocaleString("en-NG")}`
    );
    error.statusCode = 400;
    throw error;
  }

  const quote = await quoteElectricityForUser({ user, amount });
  const amountInMinorUnit = toMinorUnit(quote.sellingPrice);
  const reference = generateTransactionReference("ELEC");
  const debitResult = await debitWallet({
    userId: user._id,
    amountInMinorUnit,
    walletType: "main",
    type: "service_payment",
    reference,
    provider: provider.name,
    narration: `Electricity purchase: ${normalizedDisco} NGN ${quote.amount}`,
    metadata: {
      service: "electricity",
      disco: normalizedDisco,
      meterNumber: normalizedMeterNumber,
      meterType: normalizedMeterType,
      phone: normalizedPhone,
      amount: quote.amount,
      sellingPrice: quote.sellingPrice,
      profit: quote.profit,
      markupPercent: quote.markupPercent,
      customerReference: normalizedCustomerReference || undefined,
      verifiedMeter,
    },
  });

  try {
    const providerResult = await provider.purchaseElectricity({
      disco: normalizedDisco,
      meterNumber: normalizedMeterNumber,
      meterType: normalizedMeterType,
      phone: normalizedPhone,
      amount: quote.amount,
      reference,
    });

    debitResult.transaction.providerReference = providerResult.providerReference;
    debitResult.transaction.metadata = {
      ...debitResult.transaction.metadata,
      token: providerResult.token,
      units: providerResult.units,
      providerRequest: providerResult.requestPayload,
      providerResponse: providerResult.raw,
    };
    await debitResult.transaction.save();

    await createNotificationBestEffort({
      userId: user._id,
      title: "Electricity purchase successful",
      message: `${normalizedDisco} electricity purchase of NGN ${quote.amount} for ${normalizedMeterNumber} was successful.`,
      type: "service_purchase_success",
      channel: "both",
      priority: "normal",
      data: {
        service: "electricity",
        disco: normalizedDisco,
        meterNumber: normalizedMeterNumber,
        meterType: normalizedMeterType,
        amount: quote.sellingPrice,
        electricityValue: quote.amount,
        reference,
        provider: provider.name,
        providerReference: providerResult.providerReference,
        token: providerResult.token,
        units: providerResult.units,
      },
    });

    return {
      status: "successful",
      message: providerResult.message,
      quote,
      meter: verifiedMeter,
      token: providerResult.token,
      units: providerResult.units,
      wallet: debitResult.wallet,
      transaction: debitResult.transaction,
      providerResponse: providerResult.raw,
    };
  } catch (error) {
    const publicFailure = getPublicProviderFailure(error, "Electricity purchase");

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
      narration: `Refund for failed electricity purchase: ${normalizedDisco} NGN ${quote.amount}`,
      metadata: {
        service: "electricity",
        originalReference: reference,
        reason: publicFailure.message,
        providerFailureCode: publicFailure.code,
      },
    });

    await createNotificationBestEffort({
      userId: user._id,
      title: "Electricity purchase failed",
      message: publicFailure.message,
      type: "service_purchase_failed",
      channel: "both",
      priority: "normal",
      data: {
        service: "electricity",
        disco: normalizedDisco,
        meterNumber: normalizedMeterNumber,
        amount: quote.sellingPrice,
        electricityValue: quote.amount,
        reference,
        refundReference: refundResult.transaction.reference,
        provider: provider.name,
        failureCode: publicFailure.code,
      },
    });

    await notifyAdminsOfServiceFailureBestEffort({
      user,
      service: "electricity",
      amount: quote.sellingPrice,
      reference,
      provider: provider.name,
      providerReference: debitResult.transaction.providerReference,
      failureCode: publicFailure.code,
      transactionId: debitResult.transaction._id,
      data: {
        disco: normalizedDisco,
        meterNumber: normalizedMeterNumber,
        meterType: normalizedMeterType,
        electricityValue: quote.amount,
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

export const purchaseElectricityForUser = (payload) =>
  withServicePurchaseLock({
    userId: payload.userId,
    service: "electricity",
    operation: () => purchaseElectricityForUserUnlocked(payload),
  });

export const serializeElectricityPurchaseResult = (result) => ({
  status: result.status,
  message: result.message,
  meter: result.meter,
  token: result.token,
  units: result.units,
  quote: result.quote,
  wallet: serializeWallet(result.wallet),
  transaction: serializeTransaction(result.transaction),
  providerResponse:
    process.env.NODE_ENV === "production" ? undefined : result.providerResponse,
});

export const serializeFailedElectricityPurchase = (error) => ({
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
