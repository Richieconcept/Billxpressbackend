import CableTvServiceSetting from "../models/cableTvServiceSetting.model.js";
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
  getCableTvProvider,
  listCableTvProviders,
} from "./cableTvProviders/index.js";
import { getPublicProviderFailure } from "./providerFailure.service.js";
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

const findPackage = (packages, packageCode) =>
  packages.find(
    (item) =>
      item.code === String(packageCode || "").trim() ||
      item.providerPlanCode === String(packageCode || "").trim()
  );

export const getOrCreateCableTvServiceSetting = async () => {
  let settings = await CableTvServiceSetting.findOne({ service: "cable_tv" });

  if (!settings) {
    settings = await CableTvServiceSetting.create({ service: "cable_tv" });
  }

  return settings;
};

export const serializeCableTvServiceSetting = (settings) => ({
  id: settings._id,
  service: settings.service,
  isEnabled: settings.isEnabled,
  activeProvider: settings.activeProvider,
  availableProviders: listCableTvProviders(),
  userMarkupPercent: settings.userMarkupPercent,
  vendorMarkupPercent: settings.vendorMarkupPercent,
  roundingMode: settings.roundingMode,
  updatedBy: settings.updatedBy,
  createdAt: settings.createdAt,
  updatedAt: settings.updatedAt,
});

export const updateCableTvServiceSetting = async (payload, adminUserId) => {
  const settings = await getOrCreateCableTvServiceSetting();
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
  ];
  const receivedFields = allowedFields.filter((field) => source[field] !== undefined);

  if (receivedFields.length === 0) {
    const error = new Error(
      "No valid cable TV service settings were provided. Send JSON fields like activeProvider, userMarkupPercent, or vendorMarkupPercent."
    );
    error.statusCode = 400;
    throw error;
  }

  receivedFields.forEach((field) => {
    if (["userMarkupPercent", "vendorMarkupPercent"].includes(field)) {
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

export const getCableTvProvidersForUser = async (user) => {
  const settings = await getOrCreateCableTvServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Cable TV service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getCableTvProvider(settings.activeProvider);

  return {
    settings,
    provider: provider.name,
    tvProviders: provider.getSupportedTvProviders(),
    appliedMarkupPercent: getMarkupPercentForUser(settings, user),
  };
};

export const getCableTvPackagesForUser = async ({ user, tvProvider }) => {
  const settings = await getOrCreateCableTvServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Cable TV service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getCableTvProvider(settings.activeProvider);
  const result = await provider.getPackages({ tvProvider });
  const markupPercent = getMarkupPercentForUser(settings, user);

  return {
    ...result,
    packages: result.packages.map((item) => {
      const pricing = calculateSellingPrice({
        amount: item.amount,
        markupPercent,
        roundingMode: settings.roundingMode,
      });

      return {
        code: item.code,
        name: item.name,
        amount: item.amount,
        sellingPrice: pricing.sellingPrice,
        profit: pricing.profit,
        markupPercent,
        fixedPrice: item.fixedPrice,
      };
    }),
  };
};

export const verifyCableTvSmartcardForUser = async ({
  user,
  tvProvider,
  smartcardNumber,
}) => {
  const settings = await getOrCreateCableTvServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Cable TV service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getCableTvProvider(settings.activeProvider);

  return provider.verifySmartcard({ tvProvider, smartcardNumber });
};

export const quoteCableTvForUser = async ({ user, tvProvider, packageCode }) => {
  const settings = await getOrCreateCableTvServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Cable TV service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getCableTvProvider(settings.activeProvider);
  const packageResult = await provider.getPackages({ tvProvider });
  const selectedPackage = findPackage(packageResult.packages, packageCode);

  if (!selectedPackage) {
    const error = new Error("Selected cable TV package is not available");
    error.statusCode = 404;
    throw error;
  }

  const markupPercent = getMarkupPercentForUser(settings, user);
  const pricing = calculateSellingPrice({
    amount: selectedPackage.amount,
    markupPercent,
    roundingMode: settings.roundingMode,
  });

  return {
    tvProvider: packageResult.tvProvider,
    package: {
      code: selectedPackage.code,
      name: selectedPackage.name,
      amount: selectedPackage.amount,
      fixedPrice: selectedPackage.fixedPrice,
    },
    amount: selectedPackage.amount,
    sellingPrice: pricing.sellingPrice,
    profit: pricing.profit,
    markupPercent,
    roundingMode: settings.roundingMode,
  };
};

export const purchaseCableTvForUser = async ({
  userId,
  tvProvider,
  smartcardNumber,
  packageCode,
  phone,
  subscriptionType,
  transactionPin,
  customerReference,
  requireTransactionPin = true,
}) => {
  const normalizedTvProvider = String(tvProvider || "").trim().toUpperCase();
  const normalizedSmartcardNumber = String(smartcardNumber || "").trim();
  const normalizedPackageCode = String(packageCode || "").trim();
  const normalizedPhone = String(phone || "").trim();
  const normalizedSubscriptionType = String(subscriptionType || "change")
    .trim()
    .toLowerCase();

  if (
    !normalizedTvProvider ||
    !normalizedSmartcardNumber ||
    !normalizedPackageCode ||
    !normalizedPhone ||
    (requireTransactionPin && !transactionPin)
  ) {
    const error = new Error(
      "TV provider, smartcard number, package code, phone, and transaction PIN are required"
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

  const settings = await getOrCreateCableTvServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Cable TV service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getCableTvProvider(settings.activeProvider);
  const verifiedSmartcard = await provider.verifySmartcard({
    tvProvider: normalizedTvProvider,
    smartcardNumber: normalizedSmartcardNumber,
  });
  const quote = await quoteCableTvForUser({
    user,
    tvProvider: normalizedTvProvider,
    packageCode: normalizedPackageCode,
  });
  const amountInMinorUnit = toMinorUnit(quote.sellingPrice);
  const reference = generateTransactionReference("CABLE");
  const debitResult = await debitWallet({
    userId: user._id,
    amountInMinorUnit,
    walletType: "main",
    type: "service_payment",
    reference,
    provider: provider.name,
    narration: `Cable TV purchase: ${normalizedTvProvider} ${quote.package.name}`,
    metadata: {
      service: "cable_tv",
      tvProvider: normalizedTvProvider,
      smartcardNumber: normalizedSmartcardNumber,
      packageCode: normalizedPackageCode,
      packageName: quote.package.name,
      subscriptionType: normalizedSubscriptionType,
      phone: normalizedPhone,
      amount: quote.amount,
      sellingPrice: quote.sellingPrice,
      profit: quote.profit,
      markupPercent: quote.markupPercent,
      customerReference: normalizedCustomerReference || undefined,
      verifiedSmartcard,
    },
  });

  try {
    const providerResult = await provider.purchaseCableTv({
      tvProvider: normalizedTvProvider,
      smartcardNumber: normalizedSmartcardNumber,
      packageCode: normalizedPackageCode,
      packageAmount: quote.amount,
      phone: normalizedPhone,
      subscriptionType: normalizedSubscriptionType,
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
      title: "Cable TV purchase successful",
      message: `${normalizedTvProvider} ${quote.package.name} purchase for ${normalizedSmartcardNumber} was successful.`,
      type: "service_purchase_success",
      channel: "both",
      priority: "normal",
      data: {
        service: "cable_tv",
        tvProvider: normalizedTvProvider,
        smartcardNumber: normalizedSmartcardNumber,
        packageCode: normalizedPackageCode,
        packageName: quote.package.name,
        amount: quote.sellingPrice,
        cableTvValue: quote.amount,
        reference,
        provider: provider.name,
        providerReference: providerResult.providerReference,
      },
    });

    return {
      status: "successful",
      message: providerResult.message,
      quote,
      smartcard: verifiedSmartcard,
      wallet: debitResult.wallet,
      transaction: debitResult.transaction,
      providerResponse: providerResult.raw,
    };
  } catch (error) {
    const publicFailure = getPublicProviderFailure(error, "Cable TV purchase");

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
      narration: `Refund for failed cable TV purchase: ${normalizedTvProvider} ${quote.package.name}`,
      metadata: {
        service: "cable_tv",
        originalReference: reference,
        reason: publicFailure.message,
        providerFailureCode: publicFailure.code,
      },
    });

    await createNotificationBestEffort({
      userId: user._id,
      title: "Cable TV purchase failed",
      message: publicFailure.message,
      type: "service_purchase_failed",
      channel: "both",
      priority: "normal",
      data: {
        service: "cable_tv",
        tvProvider: normalizedTvProvider,
        smartcardNumber: normalizedSmartcardNumber,
        amount: quote.sellingPrice,
        cableTvValue: quote.amount,
        reference,
        refundReference: refundResult.transaction.reference,
        provider: provider.name,
        failureCode: publicFailure.code,
      },
    });

    await notifyAdminsOfServiceFailureBestEffort({
      user,
      service: "cable_tv",
      amount: quote.sellingPrice,
      reference,
      provider: provider.name,
      providerReference: debitResult.transaction.providerReference,
      failureCode: publicFailure.code,
      transactionId: debitResult.transaction._id,
      data: {
        tvProvider: normalizedTvProvider,
        smartcardNumber: normalizedSmartcardNumber,
        packageCode: normalizedPackageCode,
        packageName: quote.package.name,
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

export const serializeCableTvPurchaseResult = (result) => ({
  status: result.status,
  message: result.message,
  smartcard: result.smartcard,
  quote: result.quote,
  wallet: serializeWallet(result.wallet),
  transaction: serializeTransaction(result.transaction),
  providerResponse:
    process.env.NODE_ENV === "production" ? undefined : result.providerResponse,
});

export const serializeFailedCableTvPurchase = (error) => ({
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
