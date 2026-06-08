import {
  getOrCreateSocialGrowthServiceSetting,
  getSocialGrowthServicesForUser,
  listSocialGrowthOrdersForUser,
  purchaseSocialGrowthForUser,
  quoteSocialGrowthForUser,
  serializeFailedSocialGrowthPurchase,
  serializeSocialGrowthOrder,
  serializeSocialGrowthPurchaseResult,
  serializeSocialGrowthServiceSetting,
  syncSocialGrowthOrderStatus,
  updateSocialGrowthServiceSetting,
} from "../services/socialGrowth.service.js";

const sendSocialGrowthError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
    ...serializeFailedSocialGrowthPurchase(error),
  });
};

export const getSocialGrowthServices = async (req, res) => {
  try {
    const result = await getSocialGrowthServicesForUser(req.user);

    res.json({
      provider: result.provider,
      pricing: {
        userMarkupPercent: result.settings.userMarkupPercent,
        vendorMarkupPercent: result.settings.vendorMarkupPercent,
        userPricingTiers: result.settings.userPricingTiers,
        vendorPricingTiers: result.settings.vendorPricingTiers,
        appliedPricingModel: result.services.some(
          (service) => service.pricingModel === "tiered"
        )
          ? "tiered"
          : "flat",
        roundingMode: result.settings.roundingMode,
        rateUnit: "per_1000",
      },
      services: result.services,
      count: result.services.length,
    });
  } catch (error) {
    sendSocialGrowthError(res, "Could not fetch social growth services", error);
  }
};

export const quoteSocialGrowth = async (req, res) => {
  try {
    const quote = await quoteSocialGrowthForUser({
      user: req.user,
      serviceId: req.body?.serviceId,
      quantity: req.body?.quantity,
    });

    res.json({ quote });
  } catch (error) {
    sendSocialGrowthError(res, "Could not calculate social growth price", error);
  }
};

export const purchaseSocialGrowth = async (req, res) => {
  try {
    const result = await purchaseSocialGrowthForUser({
      userId: req.user._id,
      serviceId: req.body?.serviceId,
      link: req.body?.link,
      quantity: req.body?.quantity,
      runs: req.body?.runs,
      interval: req.body?.interval,
      transactionPin: req.body?.transactionPin,
    });

    res.status(201).json(serializeSocialGrowthPurchaseResult(result));
  } catch (error) {
    sendSocialGrowthError(res, "Could not place social growth order", error);
  }
};

export const listSocialGrowthOrders = async (req, res) => {
  try {
    const orders = await listSocialGrowthOrdersForUser(
      req.user._id,
      req.query?.limit
    );

    res.json({
      orders,
      count: orders.length,
    });
  } catch (error) {
    sendSocialGrowthError(res, "Could not fetch social growth orders", error);
  }
};

export const getSocialGrowthOrder = async (req, res) => {
  try {
    const order = await syncSocialGrowthOrderStatus({
      userId: req.user._id,
      orderId: req.params.orderId,
    });

    res.json({
      order: serializeSocialGrowthOrder(order),
    });
  } catch (error) {
    sendSocialGrowthError(res, "Could not fetch social growth order", error);
  }
};

export const getAdminSocialGrowthSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSocialGrowthServiceSetting();

    res.json({
      settings: serializeSocialGrowthServiceSetting(settings),
    });
  } catch (error) {
    sendSocialGrowthError(
      res,
      "Could not fetch social growth service settings",
      error
    );
  }
};

export const updateAdminSocialGrowthSettings = async (req, res) => {
  try {
    const settings = await updateSocialGrowthServiceSetting(
      req.body || {},
      req.user._id
    );

    res.json({
      message: "Social growth service settings updated successfully",
      settings: serializeSocialGrowthServiceSetting(settings),
    });
  } catch (error) {
    sendSocialGrowthError(
      res,
      "Could not update social growth service settings",
      error
    );
  }
};
