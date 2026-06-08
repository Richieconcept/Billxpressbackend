import DataServiceSetting from "../models/dataServiceSetting.model.js";
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
  availableProviders: listDataProviders(),
  userMarkupPercent: settings.userMarkupPercent,
  vendorMarkupPercent: settings.vendorMarkupPercent,
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
    "userMarkupPercent",
    "vendorMarkupPercent",
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

export const serializeDataPlanForUser = ({ plan, settings, user }) => {
  const markupPercent = getMarkupPercentForUser(settings, user);
  const pricing = calculateSellingPrice({
    costPrice: plan.costPrice,
    markupPercent,
    roundingMode: settings.roundingMode,
  });

  return {
    id: plan.providerPlanId,
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
    sellingPrice: pricing.sellingPrice,
    profit: pricing.profit,
    markupPercent,
    available: plan.available,
  };
};

export const getDataPlansForUser = async (user) => {
  const settings = await getOrCreateDataServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Data service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getDataProvider(settings.activeProvider);
  const plans = await provider.fetchPlans();
  const filteredPlans = plans.filter(
    (plan) => plan.providerPlanId && plan.network && plan.name && plan.available
  );

  return {
    settings,
    provider: provider.name,
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

export const purchaseDataForUser = async ({
  userId,
  planId,
  phone,
  transactionPin,
}) => {
  if (!planId || !phone || !transactionPin) {
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

  await verifyTransactionPin(user, transactionPin);

  const settings = await getOrCreateDataServiceSetting();

  if (!settings.isEnabled) {
    const error = new Error("Data service is currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  const provider = getDataProvider(settings.activeProvider);
  const plans = await provider.fetchPlans();
  const plan = findProviderPlan(plans, planId);

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
    const publicFailure = getPublicProviderFailure(error, "Data purchase");

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
      narration: `Refund for failed data purchase: ${pricedPlan.network} ${pricedPlan.name}`,
      metadata: {
        service: "data",
        originalReference: reference,
        reason: publicFailure.message,
        providerFailureCode: publicFailure.code,
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
