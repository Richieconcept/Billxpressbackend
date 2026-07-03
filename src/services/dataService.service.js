import DataServiceSetting from "../models/dataServiceSetting.model.js";
import DataPlan from "../models/dataPlan.model.js";
import User from "../models/user.model.js";
import {
  creditWallet,
  debitWallet,
  fromMinorUnit,
  generateTransactionReference,
  serializeTransaction,
  serializeWallet,
  toMinorUnit,
  verifyTransactionPin,
} from "./wallet.service.js";
import { createNotificationBestEffort } from "./notification.service.js";
import { getDataProvider, listDataProviders } from "./dataProviders/index.js";
import { getPublicProviderFailure } from "./providerFailure.service.js";
import { ensureUniqueCustomerReference } from "./vendorReference.service.js";

const DATA_NETWORKS = ["MTN", "AIRTEL", "GLO", "9MOBILE"];
const CATALOG_PROVIDERS = new Set(["smeapi", "smeplug"]);

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

const roundSellingPrice = (amount, roundingMode) => {
  if (roundingMode === "round") {
    return Math.round(amount);
  }

  return Math.ceil(amount);
};

const calculateSellingPrice = ({ costPrice, markupPercent, roundingMode }) => {
  const sellingPrice = roundSellingPrice(
    costPrice + costPrice * (markupPercent / 100),
    roundingMode
  );

  return {
    sellingPrice,
    profit: Math.max(0, sellingPrice - costPrice),
  };
};

export const getOrCreateDataServiceSetting = async () => {
  let settings = await DataServiceSetting.findOne({ service: "data" });

  if (!settings) {
    settings = await DataServiceSetting.create({ service: "data" });
  }

  return settings;
};

export const serializeDataServiceSetting = (settings) => ({
  id: settings._id,
  service: settings.service,
  isEnabled: settings.isEnabled,
  activeProvider: settings.activeProvider,
  networkProviders: DATA_NETWORKS.reduce((providers, network) => {
    providers[network] =
      settings.networkProviders?.[network] || settings.activeProvider;
    return providers;
  }, {}),
  availableProviders: listDataProviders(),
  userMarkupPercent: settings.userMarkupPercent,
  vendorMarkupPercent: settings.vendorMarkupPercent,
  userPricingTiers: normalizePricingTiers(settings.userPricingTiers),
  vendorPricingTiers: normalizePricingTiers(settings.vendorPricingTiers),
  roundingMode: settings.roundingMode,
  updatedBy: settings.updatedBy,
  createdAt: settings.createdAt,
  updatedAt: settings.updatedAt,
});

export const updateDataServiceSetting = async (payload, adminUserId) => {
  const settings = await getOrCreateDataServiceSetting();
  const source =
    payload && typeof payload === "object" && payload.settings
      ? payload.settings
      : payload || {};
  const allowedFields = [
    "isEnabled",
    "activeProvider",
    "networkProviders",
    "userMarkupPercent",
    "vendorMarkupPercent",
    "userPricingTiers",
    "vendorPricingTiers",
    "roundingMode",
  ];
  const receivedFields = allowedFields.filter((field) => source[field] !== undefined);

  if (receivedFields.length === 0) {
    const error = new Error(
      "No valid data service settings were provided. Send JSON fields like activeProvider, userMarkupPercent, or vendorMarkupPercent."
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
    } else if (field === "networkProviders") {
      if (!source[field] || typeof source[field] !== "object") {
        const error = new Error("Network providers must be an object");
        error.statusCode = 400;
        throw error;
      }

      if (!settings.networkProviders) {
        settings.networkProviders = {};
      }

      DATA_NETWORKS.forEach((network) => {
        if (source[field][network] !== undefined) {
          settings.networkProviders[network] = source[field][network] || null;
        }
      });
    } else {
      settings[field] = source[field];
    }
  });

  settings.updatedBy = adminUserId;
  await settings.save();

  return settings;
};

export const serializeDataPlanForUser = ({ plan, settings, user }) => {
  const pricingConfig = getPricingForUser(settings, user, plan.costPrice);
  const hasCustomPrice = Number.isFinite(Number(plan.ourPrice)) && Number(plan.ourPrice) > 0;
  const pricing = hasCustomPrice
    ? {
        sellingPrice: Number(plan.ourPrice),
        profit: Math.max(0, Number(plan.ourPrice) - plan.costPrice),
      }
    : calculateSellingPrice({
        costPrice: plan.costPrice,
        markupPercent: pricingConfig.markupPercent,
        roundingMode: settings.roundingMode,
      });

  return {
    id: plan.catalogId || plan.providerPlanId,
    provider: plan.provider,
    providerPlanId: plan.providerPlanId,
    providerPlanCode: plan.providerPlanCode,
    network: plan.network,
    networkCode: plan.networkCode,
    name: plan.name,
    type: plan.type,
    validity: plan.validity,
    validityDays: plan.validityDays,
    costPrice: plan.costPrice,
    networkPrice: plan.networkPrice,
    providerPrice: plan.providerPrice,
    ourPrice: hasCustomPrice ? Number(plan.ourPrice) : null,
    sellingPrice: pricing.sellingPrice,
    profit: pricing.profit,
    markupPercent: pricingConfig.markupPercent,
    pricingModel: hasCustomPrice ? "custom" : pricingConfig.pricingModel,
    pricingTier: pricingConfig.pricingTier,
    available: plan.available,
  };
};

const normalizePlanFilter = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const getProviderNameForNetwork = (settings, network) =>
  settings.networkProviders?.[normalizePlanFilter(network)] ||
  settings.activeProvider;

const getNetworkProviderMap = (settings) =>
  DATA_NETWORKS.reduce((providers, network) => {
    providers[network] = getProviderNameForNetwork(settings, network);
    return providers;
  }, {});

const buildPlanQuery = ({ provider, network, dataType, isEnabled } = {}) => {
  const query = {};

  if (provider) query.provider = String(provider).trim().toLowerCase();
  if (network) query.network = normalizePlanFilter(network);
  if (dataType) query.dataType = normalizePlanFilter(dataType);
  if (isEnabled !== undefined) query.isEnabled = isEnabled;

  return query;
};

const catalogDocumentToProviderPlan = (document) => ({
  catalogId: String(document._id),
  provider: document.provider,
  providerPlanId: document.providerPlanId,
  providerPlanCode: document.providerPlanCode,
  network: document.network,
  networkCode: document.networkCode,
  name: document.name,
  type: document.dataType,
  providerDataType: document.providerDataType,
  validity: document.validity,
  validityDays: document.validityDays,
  networkPrice: document.networkPrice,
  providerPrice: document.providerPrice,
  costPrice: Math.max(document.networkPrice || 0, document.providerPrice || 0),
  ourPrice: document.ourPrice,
  available: document.isEnabled && document.providerAvailable,
  allowHostedSim: document.allowHostedSim,
  allowWalletFallback: document.allowWalletFallback,
  raw: document.raw,
});

export const syncDataPlans = async ({ providerName, adminUserId } = {}) => {
  const settings = await getOrCreateDataServiceSetting();
  const provider = getDataProvider(providerName || settings.activeProvider);
  const plans = await provider.fetchPlans();
  const syncedAt = new Date();

  if (plans.length === 0) {
    const error = new Error(
      "The provider returned no data plans; the existing catalogue was left unchanged"
    );
    error.statusCode = 502;
    throw error;
  }

  await DataPlan.bulkWrite(
    plans.map((plan) => ({
      updateOne: {
        filter: {
          provider: provider.name,
          providerPlanId: String(plan.providerPlanId),
        },
        update: {
          $set: {
            providerPlanCode: String(plan.providerPlanCode || ""),
            network: normalizePlanFilter(plan.network),
            networkCode: String(plan.networkCode || ""),
            name: plan.name,
            providerDataType: String(plan.providerDataType || plan.type || ""),
            validity: plan.validity || null,
            validityDays: Number(plan.validityDays || 0),
            networkPrice: Number(plan.networkPrice || 0),
            providerPrice: Number(plan.providerPrice ?? plan.costPrice ?? 0),
            providerAvailable: plan.available !== false,
            raw: plan.raw || {},
            lastSyncedAt: syncedAt,
          },
          $setOnInsert: {
            dataType: normalizePlanFilter(plan.type || "OTHER"),
            ourPrice: null,
            isEnabled: false,
            allowHostedSim: true,
            allowWalletFallback: false,
            updatedBy: adminUserId || null,
          },
        },
        upsert: true,
      },
    }))
  );

  await DataPlan.updateMany(
    {
      provider: provider.name,
      lastSyncedAt: { $ne: syncedAt },
    },
    { $set: { providerAvailable: false } }
  );

  return {
    provider: provider.name,
    received: plans.length,
    available: await DataPlan.countDocuments({
      provider: provider.name,
      providerAvailable: true,
    }),
    disabledByProvider: await DataPlan.countDocuments({
      provider: provider.name,
      providerAvailable: false,
    }),
    syncedAt,
  };
};

export const serializeAdminDataPlan = (plan) => ({
  id: plan._id,
  provider: plan.provider,
  providerPlanId: plan.providerPlanId,
  providerPlanCode: plan.providerPlanCode,
  network: plan.network,
  networkCode: plan.networkCode,
  name: plan.name,
  dataType: plan.dataType,
  providerDataType: plan.providerDataType,
  validity: plan.validity,
  validityDays: plan.validityDays,
  networkPrice: plan.networkPrice,
  providerPrice: plan.providerPrice,
  ourPrice: plan.ourPrice,
  isEnabled: plan.isEnabled,
  allowHostedSim: plan.allowHostedSim,
  allowWalletFallback: plan.allowWalletFallback,
  providerAvailable: plan.providerAvailable,
  lastSyncedAt: plan.lastSyncedAt,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});

export const listAdminDataPlans = async (filters = {}) => {
  const query = buildPlanQuery(filters);

  if (filters.providerAvailable !== undefined) {
    query.providerAvailable = filters.providerAvailable;
  }

  return DataPlan.find(query).sort({
    network: 1,
    dataType: 1,
    networkPrice: 1,
    name: 1,
  });
};

export const updateAdminDataPlan = async ({ planId, payload, adminUserId }) => {
  const allowedFields = [
    "ourPrice",
    "isEnabled",
    "dataType",
    "allowHostedSim",
    "allowWalletFallback",
  ];
  const update = {};

  allowedFields.forEach((field) => {
    if (payload?.[field] !== undefined) update[field] = payload[field];
  });

  if (Object.keys(update).length === 0) {
    const error = new Error("No valid plan fields were provided");
    error.statusCode = 400;
    throw error;
  }

  if (update.ourPrice !== undefined) {
    update.ourPrice =
      update.ourPrice === null || update.ourPrice === ""
        ? null
        : Number(update.ourPrice);

    if (
      update.ourPrice !== null &&
      (!Number.isFinite(update.ourPrice) || update.ourPrice <= 0)
    ) {
      const error = new Error("Our price must be greater than zero");
      error.statusCode = 400;
      throw error;
    }
  }

  if (update.dataType !== undefined) {
    update.dataType = normalizePlanFilter(update.dataType);
  }

  ["isEnabled", "allowHostedSim", "allowWalletFallback"].forEach((field) => {
    if (update[field] !== undefined && typeof update[field] === "string") {
      update[field] = update[field].toLowerCase() === "true";
    }
  });

  const existing = await DataPlan.findById(planId);

  if (!existing) {
    const error = new Error("Data plan was not found");
    error.statusCode = 404;
    throw error;
  }

  const enabling = update.isEnabled === true;

  if (enabling && !existing.providerAvailable) {
    const error = new Error("This plan is currently unavailable from the provider");
    error.statusCode = 409;
    throw error;
  }

  Object.assign(existing, update, { updatedBy: adminUserId });
  await existing.save();
  return existing;
};

export const getDataPlansForUser = async (user, filters = {}) => {
  const settings = await getOrCreateDataServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Data service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const requestedNetwork = filters.network
    ? normalizePlanFilter(filters.network)
    : null;

  if (requestedNetwork && !DATA_NETWORKS.includes(requestedNetwork)) {
    const error = new Error("Unsupported data network");
    error.statusCode = 400;
    throw error;
  }

  const networkProviders = getNetworkProviderMap(settings);
  const selectedNetworks = requestedNetwork
    ? [requestedNetwork]
    : DATA_NETWORKS;
  const plans = [];

  for (const providerName of new Set(
    selectedNetworks.map((network) => networkProviders[network])
  )) {
    const provider = getDataProvider(providerName);
    const providerNetworks = selectedNetworks.filter(
      (network) => networkProviders[network] === providerName
    );

    if (CATALOG_PROVIDERS.has(provider.name)) {
      const documents = await DataPlan.find({
        provider: provider.name,
        network: { $in: providerNetworks },
        ...(filters.dataType
          ? { dataType: normalizePlanFilter(filters.dataType) }
          : {}),
        isEnabled: true,
      }).sort({ network: 1, dataType: 1, ourPrice: 1 });

      plans.push(...documents.map(catalogDocumentToProviderPlan));
    } else {
      const livePlans = await provider.fetchPlans();
      plans.push(
        ...livePlans.filter((plan) =>
          providerNetworks.includes(normalizePlanFilter(plan.network))
        )
      );
    }
  }

  const filteredPlans = plans.filter(
    (plan) =>
      plan.providerPlanId &&
      plan.network &&
      plan.name &&
      plan.available &&
      (!filters.dataType ||
        normalizePlanFilter(plan.type) === normalizePlanFilter(filters.dataType))
  );

  return {
    settings,
    provider: requestedNetwork
      ? networkProviders[requestedNetwork]
      : new Set(Object.values(networkProviders)).size === 1
        ? Object.values(networkProviders)[0]
        : "mixed",
    networkProviders,
    plans: filteredPlans.map((plan) =>
      serializeDataPlanForUser({ plan, settings, user })
    ),
  };
};

const findProviderPlan = (plans, planId) =>
  plans.find(
    (plan) =>
      String(plan.providerPlanId) === String(planId) ||
      String(plan.providerPlanCode) === String(planId)
  );

const extractProviderReference = (response) =>
  response?.transaction_id ||
  response?.transactionId ||
  response?.reference ||
  response?.ident ||
  response?.id ||
  null;

const getConfirmationWaitMs = () => {
  const value = Number(process.env.DATA_PURCHASE_CONFIRMATION_WAIT_MS || 8000);

  return Number.isFinite(value) && value >= 0 ? Math.min(value, 30000) : 8000;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const classifyProviderStatus = (response) => {
  const text = [
    response?.status,
    response?.Status,
    response?.message,
    response?.msg,
    response?.description,
    response?.error,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (text.includes("successful") || /\bsuccess\b/.test(text)) {
    return "successful";
  }

  if (
    /\b(failed|fail|declined|rejected|cancelled|canceled)\b/.test(text) ||
    /\b(invalid|incorrect|not available|unavailable|disabled)\b/.test(text)
  ) {
    return "failed";
  }

  return "unknown";
};

const confirmUnclearDataPurchase = async ({ provider, reference }) => {
  const waitMs = getConfirmationWaitMs();

  if (waitMs > 0) {
    await delay(waitMs);
  }

  if (!reference || typeof provider.checkTransactionStatus !== "function") {
    return {
      status: "unknown",
      checked: false,
      response: null,
    };
  }

  try {
    const response = await provider.checkTransactionStatus(reference);

    return {
      status: classifyProviderStatus(response),
      checked: true,
      response,
    };
  } catch (error) {
    return {
      status: "unknown",
      checked: true,
      response: error.providerResponse || error.message,
    };
  }
};

export const purchaseDataForUser = async ({
  userId,
  planId,
  phone,
  transactionPin,
  customerReference,
  requireTransactionPin = true,
}) => {
  if (!planId || !phone || (requireTransactionPin && !transactionPin)) {
    const error = new Error("Plan ID, phone number, and transaction PIN are required");
    error.statusCode = 400;
    throw error;
  }

  if (!/^0\d{10}$/.test(String(phone).trim())) {
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

  const settings = await getOrCreateDataServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Data service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const networkProviders = getNetworkProviderMap(settings);
  let provider;
  let plan;

  let catalogPlan = null;

  if (String(planId).match(/^[a-f\d]{24}$/i)) {
    catalogPlan = await DataPlan.findOne({
      _id: planId,
      provider: { $in: Array.from(CATALOG_PROVIDERS) },
    });
  } else {
    const catalogCandidates = await DataPlan.find({
      provider: { $in: Array.from(CATALOG_PROVIDERS) },
      $or: [
        { providerPlanId: String(planId) },
        { providerPlanCode: String(planId) },
      ],
    });

    catalogPlan =
      catalogCandidates.find(
        (candidate) =>
          networkProviders[candidate.network] === candidate.provider
      ) || null;
  }

  if (catalogPlan) {
    const routedProviderName = networkProviders[catalogPlan.network];

    if (catalogPlan.provider !== routedProviderName) {
      const error = new Error(
        `Selected plan is not active for ${catalogPlan.network}; the network currently uses ${routedProviderName}`
      );
      error.statusCode = 409;
      throw error;
    }

    provider = getDataProvider(catalogPlan.provider);
    plan = catalogDocumentToProviderPlan(catalogPlan);
  } else {
    for (const providerName of new Set(Object.values(networkProviders))) {
      const candidateProvider = getDataProvider(providerName);

      if (CATALOG_PROVIDERS.has(candidateProvider.name)) continue;

      const plans = await candidateProvider.fetchPlans();
      const candidatePlan = findProviderPlan(plans, planId);

      if (
        candidatePlan &&
        networkProviders[normalizePlanFilter(candidatePlan.network)] ===
          candidateProvider.name
      ) {
        provider = candidateProvider;
        plan = candidatePlan;
        break;
      }
    }
  }

  if (!provider) {
    const error = new Error("Selected data plan is not available");
    error.statusCode = 404;
    throw error;
  }

  if (!plan || !plan.available) {
    const error = new Error("Selected data plan is not available");
    error.statusCode = 404;
    throw error;
  }

  const pricedPlan = serializeDataPlanForUser({ plan, settings, user });
  const amountInMinorUnit = toMinorUnit(pricedPlan.sellingPrice);
  const reference = generateTransactionReference("DATA");
  const debitResult = await debitWallet({
    userId: user._id,
    amountInMinorUnit,
    walletType: "main",
    type: "service_payment",
    reference,
    provider: provider.name,
    narration: `Data purchase: ${pricedPlan.network} ${pricedPlan.name}`,
    metadata: {
      service: "data",
      phone,
      plan: pricedPlan,
      costPrice: pricedPlan.costPrice,
      sellingPrice: pricedPlan.sellingPrice,
      profit: pricedPlan.profit,
      markupPercent: pricedPlan.markupPercent,
      customerReference: normalizedCustomerReference || undefined,
    },
  });

  try {
    const providerResult = await provider.purchaseData({
      plan,
      phone: String(phone).trim(),
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
      title: "Data purchase successful",
      message: `${pricedPlan.network} ${pricedPlan.name} data purchase for ${phone} was successful.`,
      type: "service_purchase_success",
      channel: "both",
      priority: "normal",
      data: {
        service: "data",
        phone,
        amount: pricedPlan.sellingPrice,
        reference,
        provider: provider.name,
        providerReference: providerResult.providerReference,
      },
    });

    return {
      status: "successful",
      message: providerResult.message,
      plan: pricedPlan,
      wallet: debitResult.wallet,
      transaction: debitResult.transaction,
      providerResponse: providerResult.raw,
    };
  } catch (error) {
    const providerReference = extractProviderReference(error.providerResponse);
    let confirmation = null;

    if (providerReference) {
      debitResult.transaction.providerReference = providerReference;
    }

    if (error.isFinalProviderFailure !== true) {
      confirmation = await confirmUnclearDataPurchase({
        provider,
        reference: providerReference,
      });

      if (confirmation.status === "successful") {
        debitResult.transaction.status = "successful";
        debitResult.transaction.metadata = {
          ...debitResult.transaction.metadata,
          providerError: error.providerResponse || error.message,
          providerConfirmation: confirmation,
        };
        await debitResult.transaction.save();

        await createNotificationBestEffort({
          userId: user._id,
          title: "Data purchase successful",
          message: `${pricedPlan.network} ${pricedPlan.name} data purchase for ${phone} was successful.`,
          type: "service_purchase_success",
          channel: "both",
          priority: "normal",
          data: {
            service: "data",
            phone,
            amount: pricedPlan.sellingPrice,
            reference,
            provider: provider.name,
            providerReference,
          },
        });

        return {
          status: "successful",
          message: "Data purchase successful",
          plan: pricedPlan,
          wallet: debitResult.wallet,
          transaction: debitResult.transaction,
          providerResponse: confirmation.response,
        };
      }
    }

    const publicFailure = getPublicProviderFailure(error, "Data purchase");

    debitResult.transaction.status = "reversed";
    debitResult.transaction.metadata = {
      ...debitResult.transaction.metadata,
      providerError: error.providerResponse || error.message,
      publicError: publicFailure,
      providerConfirmation: confirmation,
    };
    await debitResult.transaction.save();

    const refundResult = await creditWallet({
      userId: user._id,
      amountInMinorUnit,
      walletType: "main",
      type: "reversal",
      reference: `${reference}_REV`,
      provider: provider.name,
      narration: `Refund for failed data purchase: ${pricedPlan.network} ${pricedPlan.name}`,
      metadata: {
        service: "data",
        originalReference: reference,
        reason: publicFailure.message,
        providerFailureCode: publicFailure.code,
        providerConfirmation: confirmation,
      },
    });

    await createNotificationBestEffort({
      userId: user._id,
      title: "Data purchase failed",
      message: publicFailure.message,
      type: "service_purchase_failed",
      channel: "both",
      priority: "normal",
      data: {
        service: "data",
        phone,
        amount: pricedPlan.sellingPrice,
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

export const serializeDataPurchaseResult = (result) => ({
  status: result.status,
  message: result.message,
  plan: result.plan,
  wallet: serializeWallet(result.wallet),
  transaction: serializeTransaction(result.transaction),
  providerResponse:
    process.env.NODE_ENV === "production" ? undefined : result.providerResponse,
});

export const serializeFailedDataPurchase = (error) => ({
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
