import SocialGrowthOrder from "../models/socialGrowthOrder.model.js";
import SocialGrowthServiceSetting from "../models/socialGrowthServiceSetting.model.js";
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
import { createNotificationBestEffort } from "./notification.service.js";
import { getPublicProviderFailure } from "./providerFailure.service.js";
import {
  getSocialGrowthProvider,
  listSocialGrowthProviders,
} from "./socialGrowthProviders/index.js";

const normalizePricingTiers = (tiers = []) =>
  (Array.isArray(tiers) ? tiers : [])
    .map((tier) => ({
      minCost: Number(tier.minCost),
      maxCost:
        tier.maxCost === null || tier.maxCost === undefined || tier.maxCost === ""
          ? null
          : Number(tier.maxCost),
      markupPercent: Number(tier.markupPercent),
    }))
    .filter(
      (tier) =>
        Number.isFinite(tier.minCost) &&
        tier.minCost >= 0 &&
        (tier.maxCost === null ||
          (Number.isFinite(tier.maxCost) && tier.maxCost >= tier.minCost)) &&
        Number.isFinite(tier.markupPercent) &&
        tier.markupPercent >= 0 &&
        tier.markupPercent <= 100
    )
    .sort((a, b) => a.minCost - b.minCost);

const isVendorUser = (user) => user.role === "vendor" && user.isVendorActive;

const getPricingTierForCost = (tiers = [], costPrice) =>
  normalizePricingTiers(tiers).find(
    (tier) =>
      costPrice >= tier.minCost &&
      (tier.maxCost === null || costPrice <= tier.maxCost)
  );

const getPricingForUser = (settings, user, costPrice) => {
  const vendor = isVendorUser(user);
  const tiers = vendor ? settings.vendorPricingTiers : settings.userPricingTiers;
  const fallbackMarkupPercent = vendor
    ? settings.vendorMarkupPercent
    : settings.userMarkupPercent;
  const matchedTier = getPricingTierForCost(tiers, costPrice);

  return {
    markupPercent: matchedTier?.markupPercent ?? fallbackMarkupPercent,
    pricingModel: matchedTier ? "tiered" : "flat",
    pricingTier: matchedTier || null,
  };
};

const roundSellingPrice = (amount, roundingMode) =>
  roundingMode === "round" ? Math.round(amount) : Math.ceil(amount);

const calculateOrderCost = ({ rate, quantity }) =>
  Number(((Number(quantity) / 1000) * Number(rate)).toFixed(2));

const calculateSellingPrice = ({ costPrice, markupPercent, roundingMode }) => {
  const sellingPrice = roundSellingPrice(
    costPrice + costPrice * (markupPercent / 100),
    roundingMode
  );

  return {
    sellingPrice,
    profit: Math.max(0, Number((sellingPrice - costPrice).toFixed(2))),
  };
};

export const getOrCreateSocialGrowthServiceSetting = async () => {
  let settings = await SocialGrowthServiceSetting.findOne({
    service: "social_growth",
  });

  if (!settings) {
    settings = await SocialGrowthServiceSetting.create({
      service: "social_growth",
    });
  }

  return settings;
};

export const serializeSocialGrowthServiceSetting = (settings) => ({
  id: settings._id,
  service: settings.service,
  isEnabled: settings.isEnabled,
  activeProvider: settings.activeProvider,
  availableProviders: listSocialGrowthProviders(),
  userMarkupPercent: settings.userMarkupPercent,
  vendorMarkupPercent: settings.vendorMarkupPercent,
  userPricingTiers: normalizePricingTiers(settings.userPricingTiers),
  vendorPricingTiers: normalizePricingTiers(settings.vendorPricingTiers),
  roundingMode: settings.roundingMode,
  updatedBy: settings.updatedBy,
  createdAt: settings.createdAt,
  updatedAt: settings.updatedAt,
});

export const updateSocialGrowthServiceSetting = async (payload, adminUserId) => {
  const settings = await getOrCreateSocialGrowthServiceSetting();
  const source =
    payload && typeof payload === "object" && payload.settings
      ? payload.settings
      : payload || {};
  const allowedFields = [
    "isEnabled",
    "activeProvider",
    "userMarkupPercent",
    "vendorMarkupPercent",
    "userPricingTiers",
    "vendorPricingTiers",
    "roundingMode",
  ];
  const receivedFields = allowedFields.filter((field) => source[field] !== undefined);

  if (receivedFields.length === 0) {
    const error = new Error(
      "No valid social growth settings were provided. Send JSON fields like activeProvider, userPricingTiers, or vendorPricingTiers."
    );
    error.statusCode = 400;
    throw error;
  }

  receivedFields.forEach((field) => {
    if (["userMarkupPercent", "vendorMarkupPercent"].includes(field)) {
      settings[field] = Number(source[field]);
    } else if (["userPricingTiers", "vendorPricingTiers"].includes(field)) {
      settings[field] = normalizePricingTiers(source[field]);
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

export const serializeSocialGrowthProviderService = ({
  providerService,
  settings,
  user,
  quantity,
}) => {
  const safeQuantity = Number(quantity) || providerService.min;
  const costPrice = calculateOrderCost({
    rate: providerService.rate,
    quantity: safeQuantity,
  });
  const pricingConfig = getPricingForUser(settings, user, costPrice);
  const pricing = calculateSellingPrice({
    costPrice,
    markupPercent: pricingConfig.markupPercent,
    roundingMode: settings.roundingMode,
  });

  return {
    id: providerService.providerServiceId,
    provider: providerService.provider,
    providerServiceId: providerService.providerServiceId,
    name: providerService.name,
    category: providerService.category,
    rate: providerService.rate,
    rateUnit: "per_1000",
    min: providerService.min,
    max: providerService.max,
    refill: providerService.refill,
    dripFeed: providerService.dripFeed,
    type: providerService.type,
    currency: providerService.currency,
    quoteQuantity: safeQuantity,
    costPrice,
    sellingPrice: pricing.sellingPrice,
    profit: pricing.profit,
    markupPercent: pricingConfig.markupPercent,
    pricingModel: pricingConfig.pricingModel,
    pricingTier: pricingConfig.pricingTier,
    available: providerService.available,
  };
};

const findProviderService = (services, serviceId) =>
  services.find(
    (service) => String(service.providerServiceId) === String(serviceId)
  );

const validateQuantity = (providerService, quantity) => {
  const numericQuantity = Number(quantity);

  if (!Number.isFinite(numericQuantity) || numericQuantity < 1) {
    const error = new Error("Quantity must be greater than zero");
    error.statusCode = 400;
    throw error;
  }

  if (numericQuantity < providerService.min) {
    const error = new Error(`Minimum quantity for this service is ${providerService.min}`);
    error.statusCode = 400;
    throw error;
  }

  if (numericQuantity > providerService.max) {
    const error = new Error(`Maximum quantity for this service is ${providerService.max}`);
    error.statusCode = 400;
    throw error;
  }

  return Math.round(numericQuantity);
};

export const getSocialGrowthServicesForUser = async (user) => {
  const settings = await getOrCreateSocialGrowthServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Social growth service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getSocialGrowthProvider(settings.activeProvider);
  const services = await provider.fetchServices();

  return {
    settings,
    provider: provider.name,
    services: services.map((providerService) =>
      serializeSocialGrowthProviderService({
        providerService,
        settings,
        user,
        quantity: providerService.min,
      })
    ),
  };
};

export const quoteSocialGrowthForUser = async ({ user, serviceId, quantity }) => {
  if (!serviceId || !quantity) {
    const error = new Error("Service ID and quantity are required");
    error.statusCode = 400;
    throw error;
  }

  const settings = await getOrCreateSocialGrowthServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Social growth service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getSocialGrowthProvider(settings.activeProvider);
  const services = await provider.fetchServices();
  const providerService = findProviderService(services, serviceId);

  if (!providerService || !providerService.available) {
    const error = new Error("Selected social growth service is not available");
    error.statusCode = 404;
    throw error;
  }

  const safeQuantity = validateQuantity(providerService, quantity);

  return serializeSocialGrowthProviderService({
    providerService,
    settings,
    user,
    quantity: safeQuantity,
  });
};

export const purchaseSocialGrowthForUser = async ({
  userId,
  serviceId,
  link,
  quantity,
  runs,
  interval,
  transactionPin,
}) => {
  const normalizedLink = String(link || "").trim();

  if (!serviceId || !normalizedLink || !quantity || !transactionPin) {
    const error = new Error(
      "Service ID, link, quantity, and transaction PIN are required"
    );
    error.statusCode = 400;
    throw error;
  }

  if (!/^https?:\/\/\S+/i.test(normalizedLink)) {
    const error = new Error("Please provide a valid social media link");
    error.statusCode = 400;
    throw error;
  }

  const user = await User.findById(userId).select("+transactionPin");

  if (!user || !user.isActive) {
    const error = new Error("User account is not active");
    error.statusCode = 401;
    throw error;
  }

  await verifyTransactionPin(user, transactionPin);

  const quote = await quoteSocialGrowthForUser({
    user,
    serviceId,
    quantity,
  });
  const amountInMinorUnit = toMinorUnit(quote.sellingPrice);
  const provider = getSocialGrowthProvider(quote.provider);
  const reference = generateTransactionReference("SOCIAL");
  const debitResult = await debitWallet({
    userId: user._id,
    amountInMinorUnit,
    walletType: "main",
    type: "service_payment",
    reference,
    provider: provider.name,
    narration: `Social growth order: ${quote.name}`,
    metadata: {
      service: "social_growth",
      socialService: quote,
      link: normalizedLink,
      quantity: quote.quoteQuantity,
      costPrice: quote.costPrice,
      sellingPrice: quote.sellingPrice,
      profit: quote.profit,
      markupPercent: quote.markupPercent,
    },
  });

  try {
    const providerResult = await provider.createOrder({
      service: quote,
      link: normalizedLink,
      quantity: quote.quoteQuantity,
      runs,
      interval,
    });

    const order = await SocialGrowthOrder.create({
      user: user._id,
      provider: provider.name,
      providerOrderId: providerResult.providerOrderId,
      serviceId: quote.providerServiceId,
      serviceName: quote.name,
      category: quote.category,
      link: normalizedLink,
      quantity: quote.quoteQuantity,
      runs: runs ? Number(runs) : null,
      interval: interval ? Number(interval) : null,
      costPrice: quote.costPrice,
      sellingPrice: quote.sellingPrice,
      profit: quote.profit,
      markupPercent: quote.markupPercent,
      status: "processing",
      currency: quote.currency,
      transaction: debitResult.transaction._id,
      providerResponse: providerResult.raw,
    });

    debitResult.transaction.providerReference = providerResult.providerOrderId;
    debitResult.transaction.metadata = {
      ...debitResult.transaction.metadata,
      providerRequest: providerResult.requestPayload,
      providerResponse: providerResult.raw,
      socialGrowthOrderId: order._id,
    };
    await debitResult.transaction.save();

    await createNotificationBestEffort({
      userId: user._id,
      title: "Social growth order placed",
      message: `${quote.name} order has been placed successfully.`,
      type: "service_purchase_success",
      channel: "both",
      priority: "normal",
      data: {
        service: "social_growth",
        serviceId: quote.providerServiceId,
        orderId: order._id,
        providerOrderId: providerResult.providerOrderId,
        amount: quote.sellingPrice,
        quantity: quote.quoteQuantity,
        reference,
        provider: provider.name,
      },
    });

    return {
      status: "successful",
      message: providerResult.message,
      quote,
      order,
      wallet: debitResult.wallet,
      transaction: debitResult.transaction,
      providerResponse: providerResult.raw,
    };
  } catch (error) {
    const publicFailure = getPublicProviderFailure(error, "Social growth order");

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
      narration: `Refund for failed social growth order: ${quote.name}`,
      metadata: {
        service: "social_growth",
        originalReference: reference,
        reason: publicFailure.message,
        providerFailureCode: publicFailure.code,
      },
    });

    await createNotificationBestEffort({
      userId: user._id,
      title: "Social growth order failed",
      message: publicFailure.message,
      type: "service_purchase_failed",
      channel: "both",
      priority: "normal",
      data: {
        service: "social_growth",
        serviceId: quote.providerServiceId,
        amount: quote.sellingPrice,
        quantity: quote.quoteQuantity,
        reference,
        refundReference: refundResult.transaction.reference,
        provider: provider.name,
        failureCode: publicFailure.code,
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

export const serializeSocialGrowthOrder = (order) => ({
  id: order._id,
  provider: order.provider,
  providerOrderId: order.providerOrderId,
  serviceId: order.serviceId,
  serviceName: order.serviceName,
  category: order.category,
  link: order.link,
  quantity: order.quantity,
  runs: order.runs,
  interval: order.interval,
  costPrice: order.costPrice,
  sellingPrice: order.sellingPrice,
  profit: order.profit,
  markupPercent: order.markupPercent,
  status: order.status,
  startCount: order.startCount,
  remains: order.remains,
  charge: order.charge,
  currency: order.currency,
  transaction: order.transaction,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

export const listSocialGrowthOrdersForUser = async (userId, limit = 50) => {
  const orders = await SocialGrowthOrder.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100));

  return orders.map((order) => serializeSocialGrowthOrder(order));
};

export const syncSocialGrowthOrderStatus = async ({ userId, orderId }) => {
  const order = await SocialGrowthOrder.findOne({ _id: orderId, user: userId });

  if (!order) {
    const error = new Error("Social growth order not found");
    error.statusCode = 404;
    throw error;
  }

  if (!order.providerOrderId) {
    return order;
  }

  const provider = getSocialGrowthProvider(order.provider);
  const statusResult = await provider.fetchOrderStatus(order.providerOrderId);

  order.status = statusResult.status;
  order.startCount = statusResult.startCount;
  order.remains = statusResult.remains;
  order.charge = statusResult.charge;
  order.currency = statusResult.currency || order.currency;
  order.providerResponse = {
    ...order.providerResponse,
    statusCheck: statusResult.raw,
  };
  await order.save();

  return order;
};

export const serializeSocialGrowthPurchaseResult = (result) => ({
  status: result.status,
  message: result.message,
  quote: result.quote,
  order: serializeSocialGrowthOrder(result.order),
  wallet: serializeWallet(result.wallet),
  transaction: serializeTransaction(result.transaction),
  providerResponse:
    process.env.NODE_ENV === "production" ? undefined : result.providerResponse,
});

export const serializeFailedSocialGrowthPurchase = (error) => ({
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
