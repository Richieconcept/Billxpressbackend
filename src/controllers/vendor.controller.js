import Transaction from "../models/transaction.model.js";
import {
  getAirtimeNetworksForUser,
  purchaseAirtimeForUser,
  quoteAirtimeForUser,
} from "../services/airtimeService.service.js";
import {
  getCableTvPackagesForUser,
  getCableTvProvidersForUser,
  purchaseCableTvForUser,
  quoteCableTvForUser,
  verifyCableTvSmartcardForUser,
} from "../services/cableTvService.service.js";
import {
  getDataPlansForUser,
  purchaseDataForUser,
} from "../services/dataService.service.js";
import {
  getSocialGrowthServicesForUser,
  listSocialGrowthOrdersForUser,
  purchaseSocialGrowthForUser,
  quoteSocialGrowthForUser,
  serializeSocialGrowthOrder,
  syncSocialGrowthOrderStatus,
} from "../services/socialGrowth.service.js";
import {
  getOrCreateWallet,
  serializeTransaction,
  serializeWallet,
} from "../services/wallet.service.js";
import { sanitizeUser } from "../utils/sanitizeUser.js";

const success = (res, message, data = {}, statusCode = 200) =>
  res.status(statusCode).json({
    success: true,
    message,
    data,
  });

const getErrorCode = (error) => {
  if (error.code) {
    return error.code;
  }

  if (error.message === "Insufficient wallet balance") {
    return "INSUFFICIENT_BALANCE";
  }

  if (error.statusCode === 401) {
    return "INVALID_API_KEY";
  }

  if (error.statusCode === 503) {
    return "SERVICE_UNAVAILABLE";
  }

  if (error.statusCode === 404) {
    return "NOT_FOUND";
  }

  if (error.statusCode === 400) {
    return "VALIDATION_ERROR";
  }

  return "SERVER_ERROR";
};

const sendVendorError = (res, publicMessage, error) => {
  const statusCode = error.statusCode || 500;
  const body = {
    success: false,
    message: error.statusCode ? error.message : publicMessage,
    code: getErrorCode(error),
  };

  if (error.transaction) {
    body.data = {
      transaction: serializeTransaction(error.transaction),
    };
  }

  if (error.refundTransaction || error.wallet) {
    body.data = {
      ...(body.data || {}),
      refundTransaction: error.refundTransaction
        ? serializeTransaction(error.refundTransaction)
        : undefined,
      wallet: error.wallet ? serializeWallet(error.wallet) : undefined,
    };
  }

  if (process.env.NODE_ENV !== "production") {
    body.error = error.message;
  }

  res.status(statusCode).json(body);
};

const serializeVendorTransaction = (transaction) => {
  const serialized = serializeTransaction(transaction);

  return {
    ...serialized,
    service: transaction.metadata?.service,
    customerReference: transaction.metadata?.customerReference,
  };
};

const buildReferenceQuery = ({ userId, reference, service }) => ({
  user: userId,
  type: "service_payment",
  ...(service ? { "metadata.service": service } : {}),
  $or: [
    { reference },
    { providerReference: reference },
    { "metadata.customerReference": reference },
  ],
});

const findVendorTransaction = async ({ userId, reference, service }) =>
  Transaction.findOne(buildReferenceQuery({ userId, reference, service })).sort({
    createdAt: -1,
  });

const purchasePayload = (result, service, extra = {}) => ({
  reference: result.transaction.reference,
  customerReference: result.transaction.metadata?.customerReference,
  providerReference: result.transaction.providerReference,
  status: result.transaction.status,
  service,
  amount: serializeTransaction(result.transaction).amount,
  transaction: serializeVendorTransaction(result.transaction),
  wallet: serializeWallet(result.wallet),
  ...extra,
});

export const getVendorProfile = async (req, res) => {
  try {
    const wallet = await getOrCreateWallet(req.user._id);

    success(res, "Vendor profile fetched successfully", {
      vendor: sanitizeUser(req.user),
      wallet: serializeWallet(wallet),
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch vendor profile", error);
  }
};

export const getVendorWallet = async (req, res) => {
  try {
    const wallet = await getOrCreateWallet(req.user._id);

    success(res, "Vendor wallet fetched successfully", {
      wallet: serializeWallet(wallet),
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch vendor wallet", error);
  }
};

export const listVendorTransactions = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const query = { user: req.user._id };

    if (req.query.service) {
      query["metadata.service"] = req.query.service;
    }

    if (req.query.status) {
      query.status = req.query.status;
    }

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit);

    success(res, "Vendor transactions fetched successfully", {
      transactions: transactions.map(serializeVendorTransaction),
      count: transactions.length,
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch vendor transactions", error);
  }
};

export const getVendorTransaction = async (req, res) => {
  try {
    const transaction = await findVendorTransaction({
      userId: req.user._id,
      reference: req.params.reference,
      service: req.query.service,
    });

    if (!transaction) {
      const error = new Error("Transaction not found");
      error.statusCode = 404;
      throw error;
    }

    success(res, "Transaction fetched successfully", {
      transaction: serializeVendorTransaction(transaction),
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch transaction", error);
  }
};

export const getVendorDataPlans = async (req, res) => {
  try {
    const result = await getDataPlansForUser(req.user);

    success(res, "Data plans fetched successfully", {
      provider: result.provider,
      plans: result.plans,
      count: result.plans.length,
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch data plans", error);
  }
};

export const purchaseVendorData = async (req, res) => {
  try {
    const result = await purchaseDataForUser({
      userId: req.user._id,
      planId: req.body?.planId,
      phone: req.body?.phone,
      customerReference: req.body?.customerReference,
      requireTransactionPin: false,
    });

    success(
      res,
      "Data purchase successful",
      purchasePayload(result, "data", {
        phone: req.body?.phone,
        plan: result.plan,
      }),
      201
    );
  } catch (error) {
    sendVendorError(res, "Could not purchase data", error);
  }
};

export const getVendorDataPurchase = async (req, res) => {
  req.query.service = "data";
  return getVendorTransaction(req, res);
};

export const getVendorAirtimeNetworks = async (req, res) => {
  try {
    const result = await getAirtimeNetworksForUser(req.user);

    success(res, "Airtime networks fetched successfully", {
      provider: result.provider,
      networks: result.networks,
      pricing: {
        appliedMarkupPercent: result.appliedMarkupPercent,
        roundingMode: result.settings.roundingMode,
        minimumAmount: result.settings.minimumAmount,
        maximumAmount: result.settings.maximumAmount,
      },
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch airtime networks", error);
  }
};

export const quoteVendorAirtime = async (req, res) => {
  try {
    const quote = await quoteAirtimeForUser({
      user: req.user,
      amount: req.body?.amount,
    });

    success(res, "Airtime quote calculated successfully", { quote });
  } catch (error) {
    sendVendorError(res, "Could not calculate airtime quote", error);
  }
};

export const purchaseVendorAirtime = async (req, res) => {
  try {
    const result = await purchaseAirtimeForUser({
      userId: req.user._id,
      network: req.body?.network,
      phone: req.body?.phone,
      amount: req.body?.amount,
      customerReference: req.body?.customerReference,
      requireTransactionPin: false,
    });

    success(
      res,
      "Airtime purchase successful",
      purchasePayload(result, "airtime", {
        phone: req.body?.phone,
        network: result.network,
        quote: result.quote,
      }),
      201
    );
  } catch (error) {
    sendVendorError(res, "Could not purchase airtime", error);
  }
};

export const getVendorAirtimePurchase = async (req, res) => {
  req.query.service = "airtime";
  return getVendorTransaction(req, res);
};

export const getVendorCableTvProviders = async (req, res) => {
  try {
    const result = await getCableTvProvidersForUser(req.user);

    success(res, "Cable TV providers fetched successfully", {
      provider: result.provider,
      tvProviders: result.tvProviders,
      pricing: {
        appliedMarkupPercent: result.appliedMarkupPercent,
        roundingMode: result.settings.roundingMode,
      },
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch cable TV providers", error);
  }
};

export const getVendorCableTvPackages = async (req, res) => {
  try {
    const result = await getCableTvPackagesForUser({
      user: req.user,
      tvProvider: req.query?.provider || req.query?.tvProvider,
    });

    success(res, "Cable TV packages fetched successfully", {
      provider: result.provider,
      tvProvider: result.tvProvider,
      packages: result.packages,
      count: result.packages.length,
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch cable TV packages", error);
  }
};

export const verifyVendorCableTvSmartcard = async (req, res) => {
  try {
    const smartcard = await verifyCableTvSmartcardForUser({
      user: req.user,
      tvProvider: req.body?.provider || req.body?.tvProvider,
      smartcardNumber: req.body?.smartcardNumber,
    });
    const { raw, requestPayload, ...publicSmartcard } = smartcard;

    success(res, "Smartcard verified successfully", {
      smartcard: publicSmartcard,
    });
  } catch (error) {
    sendVendorError(res, "Could not verify smartcard", error);
  }
};

export const quoteVendorCableTv = async (req, res) => {
  try {
    const quote = await quoteCableTvForUser({
      user: req.user,
      tvProvider: req.body?.provider || req.body?.tvProvider,
      packageCode: req.body?.packageCode,
    });

    success(res, "Cable TV quote calculated successfully", { quote });
  } catch (error) {
    sendVendorError(res, "Could not calculate cable TV quote", error);
  }
};

export const purchaseVendorCableTv = async (req, res) => {
  try {
    const result = await purchaseCableTvForUser({
      userId: req.user._id,
      tvProvider: req.body?.provider || req.body?.tvProvider,
      smartcardNumber: req.body?.smartcardNumber,
      packageCode: req.body?.packageCode,
      phone: req.body?.phone,
      subscriptionType: req.body?.subscriptionType,
      customerReference: req.body?.customerReference,
      requireTransactionPin: false,
    });

    success(
      res,
      "Cable TV purchase successful",
      purchasePayload(result, "cable_tv", {
        smartcardNumber: req.body?.smartcardNumber,
        quote: result.quote,
      }),
      201
    );
  } catch (error) {
    sendVendorError(res, "Could not purchase cable TV", error);
  }
};

export const getVendorCableTvPurchase = async (req, res) => {
  req.query.service = "cable_tv";
  return getVendorTransaction(req, res);
};

export const getVendorSocialGrowthServices = async (req, res) => {
  try {
    const result = await getSocialGrowthServicesForUser(req.user);

    success(res, "Social growth services fetched successfully", {
      provider: result.provider,
      services: result.services,
      count: result.services.length,
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch social growth services", error);
  }
};

export const quoteVendorSocialGrowth = async (req, res) => {
  try {
    const quote = await quoteSocialGrowthForUser({
      user: req.user,
      serviceId: req.body?.serviceId,
      quantity: req.body?.quantity,
    });

    success(res, "Social growth quote calculated successfully", { quote });
  } catch (error) {
    sendVendorError(res, "Could not calculate social growth quote", error);
  }
};

export const purchaseVendorSocialGrowth = async (req, res) => {
  try {
    const result = await purchaseSocialGrowthForUser({
      userId: req.user._id,
      serviceId: req.body?.serviceId,
      link: req.body?.link,
      quantity: req.body?.quantity,
      runs: req.body?.runs,
      interval: req.body?.interval,
      customerReference: req.body?.customerReference,
      requireTransactionPin: false,
    });

    success(
      res,
      "Social growth order placed successfully",
      purchasePayload(result, "social_growth", {
        order: serializeSocialGrowthOrder(result.order),
        quote: result.quote,
      }),
      201
    );
  } catch (error) {
    sendVendorError(res, "Could not place social growth order", error);
  }
};

export const listVendorSocialGrowthOrders = async (req, res) => {
  try {
    const orders = await listSocialGrowthOrdersForUser(
      req.user._id,
      req.query?.limit
    );

    success(res, "Social growth orders fetched successfully", {
      orders,
      count: orders.length,
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch social growth orders", error);
  }
};

export const getVendorSocialGrowthOrder = async (req, res) => {
  try {
    const order = await syncSocialGrowthOrderStatus({
      userId: req.user._id,
      orderId: req.params.orderId,
    });

    success(res, "Social growth order fetched successfully", {
      order: serializeSocialGrowthOrder(order),
    });
  } catch (error) {
    sendVendorError(res, "Could not fetch social growth order", error);
  }
};
