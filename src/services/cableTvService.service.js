import CableTvServiceSetting from "../models/cableTvServiceSetting.model.js";
import CableTvPackage from "../models/cableTvPackage.model.js";
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

const normalizeTvProvider = (tvProvider) =>
  String(tvProvider || "")
    .trim()
    .toUpperCase();

const hasPositivePrice = (value) =>
  Number.isFinite(Number(value)) && Number(value) > 0;

const getCustomPriceForUser = (item, user) =>
  user.role === "vendor" && user.isVendorActive
    ? item.vendorPrice
    : item.ourPrice;

const calculatePackagePricing = ({ item, settings, user }) => {
  const markupPercent = getMarkupPercentForUser(settings, user);
  const customPrice = getCustomPriceForUser(item, user);

  if (hasPositivePrice(customPrice)) {
    return {
      sellingPrice: Number(customPrice),
      profit: Math.max(0, Number(customPrice) - item.amount),
      markupPercent,
      pricingModel: "custom",
    };
  }

  return {
    ...calculateSellingPrice({
      amount: item.amount,
      markupPercent,
      roundingMode: settings.roundingMode,
    }),
    markupPercent,
    pricingModel: "flat",
  };
};

const packageDocumentToProviderPackage = (document) => ({
  id: String(document._id),
  code: document.providerPackageCode,
  providerPackageCode: document.providerPackageCode,
  name: document.name,
  amount: document.amount,
  ourPrice: document.ourPrice,
  vendorPrice: document.vendorPrice,
  fixedPrice: document.fixedPrice,
  providerAvailable: document.providerAvailable,
  isEnabled: document.isEnabled,
  raw: document.raw,
});

const serializeCableTvPackageForUser = ({ item, settings, user }) => {
  const pricing = calculatePackagePricing({ item, settings, user });
  const vendor = user.role === "vendor" && user.isVendorActive;

  return {
    id: item.id,
    code: item.code,
    name: item.name,
    amount: item.amount,
    ourPrice: !vendor && hasPositivePrice(item.ourPrice) ? Number(item.ourPrice) : null,
    vendorPrice: vendor && hasPositivePrice(item.vendorPrice)
      ? Number(item.vendorPrice)
      : undefined,
    sellingPrice: pricing.sellingPrice,
    profit: pricing.profit,
    markupPercent: pricing.markupPercent,
    pricingModel: pricing.pricingModel,
    fixedPrice: item.fixedPrice,
  };
};

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

export const syncCableTvPackages = async ({ providerName, adminUserId } = {}) => {
  const settings = await getOrCreateCableTvServiceSetting();
  const provider = getCableTvProvider(providerName || settings.activeProvider);
  const tvProviders = provider.getSupportedTvProviders();
  const syncedAt = new Date();
  const packageGroups = await Promise.all(
    tvProviders
      .filter((item) => item.available !== false)
      .map((item) => provider.getPackages({ tvProvider: item.code }))
  );
  const packages = packageGroups.flatMap((group) =>
    group.packages.map((item) => ({
      provider: provider.name,
      tvProvider: normalizeTvProvider(group.tvProvider.code),
      tvProviderName: group.tvProvider.name,
      providerPackageCode: String(item.code || ""),
      name: item.name,
      amount: Number(item.amount || 0),
      fixedPrice: item.fixedPrice !== false,
      raw: item.raw || {},
    }))
  );

  if (packages.length === 0) {
    const error = new Error(
      "The provider returned no cable TV packages; the existing catalogue was left unchanged"
    );
    error.statusCode = 502;
    throw error;
  }

  await CableTvPackage.bulkWrite(
    packages.map((item) => ({
      updateOne: {
        filter: {
          provider: item.provider,
          tvProvider: item.tvProvider,
          providerPackageCode: item.providerPackageCode,
        },
        update: {
          $set: {
            tvProviderName: item.tvProviderName,
            name: item.name,
            amount: item.amount,
            fixedPrice: item.fixedPrice,
            providerAvailable: true,
            raw: item.raw,
            lastSyncedAt: syncedAt,
          },
          $setOnInsert: {
            ourPrice: null,
            vendorPrice: null,
            isEnabled: false,
            updatedBy: adminUserId || null,
          },
        },
        upsert: true,
      },
    }))
  );

  await CableTvPackage.updateMany(
    {
      provider: provider.name,
      lastSyncedAt: { $ne: syncedAt },
    },
    { $set: { providerAvailable: false } }
  );

  return {
    provider: provider.name,
    received: packages.length,
    available: await CableTvPackage.countDocuments({
      provider: provider.name,
      providerAvailable: true,
    }),
    disabledByProvider: await CableTvPackage.countDocuments({
      provider: provider.name,
      providerAvailable: false,
    }),
    syncedAt,
  };
};

export const serializeAdminCableTvPackage = (item) => ({
  id: item._id,
  provider: item.provider,
  tvProvider: item.tvProvider,
  tvProviderName: item.tvProviderName,
  providerPackageCode: item.providerPackageCode,
  name: item.name,
  amount: item.amount,
  ourPrice: item.ourPrice,
  vendorPrice: item.vendorPrice,
  fixedPrice: item.fixedPrice,
  isEnabled: item.isEnabled,
  providerAvailable: item.providerAvailable,
  available: item.isEnabled && item.providerAvailable,
  lastSyncedAt: item.lastSyncedAt,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

export const listAdminCableTvPackages = async (filters = {}) => {
  const query = {};

  if (filters.provider) query.provider = String(filters.provider).trim().toLowerCase();
  if (filters.tvProvider) query.tvProvider = normalizeTvProvider(filters.tvProvider);
  if (filters.isEnabled !== undefined) query.isEnabled = filters.isEnabled;
  if (filters.providerAvailable !== undefined) {
    query.providerAvailable = filters.providerAvailable;
  }

  return CableTvPackage.find(query).sort({
    tvProvider: 1,
    amount: 1,
    name: 1,
  });
};

export const updateAdminCableTvPackage = async ({
  packageId,
  payload,
  adminUserId,
}) => {
  const allowedFields = ["ourPrice", "vendorPrice", "isEnabled"];
  const update = {};

  allowedFields.forEach((field) => {
    if (payload?.[field] !== undefined) update[field] = payload[field];
  });

  if (Object.keys(update).length === 0) {
    const error = new Error("No valid package fields were provided");
    error.statusCode = 400;
    throw error;
  }

  ["ourPrice", "vendorPrice"].forEach((field) => {
    if (update[field] === undefined) return;

    update[field] =
      update[field] === null || update[field] === ""
        ? null
        : Number(update[field]);

    if (
      update[field] !== null &&
      (!Number.isFinite(update[field]) || update[field] <= 0)
    ) {
      const error = new Error(
        `${field === "ourPrice" ? "Our price" : "Vendor price"} must be greater than zero`
      );
      error.statusCode = 400;
      throw error;
    }
  });

  if (update.isEnabled !== undefined && typeof update.isEnabled === "string") {
    update.isEnabled = update.isEnabled.toLowerCase() === "true";
  }

  const existing = await CableTvPackage.findById(packageId);

  if (!existing) {
    const error = new Error("Cable TV package was not found");
    error.statusCode = 404;
    throw error;
  }

  if (update.isEnabled === true && !existing.providerAvailable) {
    const error = new Error("This package is currently unavailable from the provider");
    error.statusCode = 409;
    throw error;
  }

  Object.assign(existing, update, { updatedBy: adminUserId });
  await existing.save();
  return existing;
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
  const normalizedTvProvider = normalizeTvProvider(tvProvider);
  const providerConfig = provider
    .getSupportedTvProviders()
    .find((item) => item.code === normalizedTvProvider);

  if (!providerConfig) {
    const error = new Error("Selected cable TV provider is not supported");
    error.statusCode = 400;
    throw error;
  }

  const documents = await CableTvPackage.find({
    provider: provider.name,
    tvProvider: normalizedTvProvider,
    isEnabled: true,
    providerAvailable: true,
  }).sort({ amount: 1, name: 1 });

  return {
    provider: provider.name,
    tvProvider: {
      code: providerConfig.code,
      name: providerConfig.name,
      serviceID: providerConfig.serviceID,
    },
    packages: documents.map((item) =>
      serializeCableTvPackageForUser({
        item: packageDocumentToProviderPackage(item),
        settings,
        user,
      })
    ),
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
  const normalizedTvProvider = normalizeTvProvider(tvProvider);
  const packageQuery = String(packageCode || "").trim().match(/^[a-f\d]{24}$/i)
    ? { _id: packageCode }
    : { providerPackageCode: String(packageCode || "").trim() };
  const selectedPackage = await CableTvPackage.findOne({
    provider: provider.name,
    tvProvider: normalizedTvProvider,
    isEnabled: true,
    providerAvailable: true,
    ...packageQuery,
  });

  if (!selectedPackage) {
    const error = new Error("Selected cable TV package is not available");
    error.statusCode = 404;
    throw error;
  }

  const providerConfig = provider
    .getSupportedTvProviders()
    .find((item) => item.code === normalizedTvProvider);
  const providerPackage = packageDocumentToProviderPackage(selectedPackage);
  const pricing = calculatePackagePricing({
    item: providerPackage,
    settings,
    user,
  });
  const vendor = user.role === "vendor" && user.isVendorActive;

  return {
    tvProvider: {
      code: providerConfig?.code || normalizedTvProvider,
      name: providerConfig?.name || selectedPackage.tvProviderName,
      serviceID: providerConfig?.serviceID,
    },
    package: {
      id: String(selectedPackage._id),
      code: selectedPackage.providerPackageCode,
      name: selectedPackage.name,
      amount: selectedPackage.amount,
      fixedPrice: selectedPackage.fixedPrice,
      ourPrice: !vendor && hasPositivePrice(selectedPackage.ourPrice)
        ? Number(selectedPackage.ourPrice)
        : null,
      vendorPrice: vendor && hasPositivePrice(selectedPackage.vendorPrice)
        ? Number(selectedPackage.vendorPrice)
        : undefined,
    },
    amount: selectedPackage.amount,
    sellingPrice: pricing.sellingPrice,
    profit: pricing.profit,
    markupPercent: pricing.markupPercent,
    pricingModel: pricing.pricingModel,
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
      packageCode: quote.package.code,
      selectedPackageId: quote.package.id,
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
      packageCode: quote.package.code,
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
        packageCode: quote.package.code,
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
        packageCode: quote.package.code,
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
