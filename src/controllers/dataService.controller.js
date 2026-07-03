import {
  getDataPlansForUser,
  getOrCreateDataServiceSetting,
  listAdminDataPlans,
  purchaseDataForUser,
  serializeAdminDataPlan,
  serializeDataPurchaseResult,
  serializeDataServiceSetting,
  serializeFailedDataPurchase,
  syncDataPlans,
  updateAdminDataPlan,
  updateDataServiceSetting,
} from "../services/dataService.service.js";

const sendDataServiceError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
    ...serializeFailedDataPurchase(error),
  });
};

export const getDataPlans = async (req, res) => {
  try {
    const result = await getDataPlansForUser(req.user, {
      network: req.query.network,
      dataType: req.query.dataType || req.query.type,
    });

    res.json({
      provider: result.provider,
      pricing: {
        userMarkupPercent: result.settings.userMarkupPercent,
        vendorMarkupPercent: result.settings.vendorMarkupPercent,
        userPricingTiers: result.settings.userPricingTiers,
        vendorPricingTiers: result.settings.vendorPricingTiers,
        appliedPricingModel: result.plans.some(
          (plan) => plan.pricingModel === "tiered"
        )
          ? "tiered"
          : "flat",
        roundingMode: result.settings.roundingMode,
      },
      networkProviders: result.networkProviders,
      plans: result.plans,
      count: result.plans.length,
    });
  } catch (error) {
    sendDataServiceError(res, "Could not fetch data plans", error);
  }
};

const parseOptionalBoolean = (value) => {
  if (value === undefined) return undefined;
  return String(value).toLowerCase() === "true";
};

export const getAdminDataPlans = async (req, res) => {
  try {
    const plans = await listAdminDataPlans({
      provider: req.query.provider,
      network: req.query.network,
      dataType: req.query.dataType || req.query.type,
      isEnabled: parseOptionalBoolean(req.query.isEnabled),
      providerAvailable: parseOptionalBoolean(req.query.providerAvailable),
    });

    res.json({
      plans: plans.map(serializeAdminDataPlan),
      count: plans.length,
    });
  } catch (error) {
    sendDataServiceError(res, "Could not fetch admin data plans", error);
  }
};

export const syncAdminDataPlans = async (req, res) => {
  try {
    const result = await syncDataPlans({
      providerName: req.body?.provider,
      adminUserId: req.user._id,
    });

    res.json({
      message: "Data plans synchronized successfully",
      sync: result,
    });
  } catch (error) {
    sendDataServiceError(res, "Could not synchronize data plans", error);
  }
};

export const updateAdminDataPlanById = async (req, res) => {
  try {
    const plan = await updateAdminDataPlan({
      planId: req.params.planId,
      payload: req.body || {},
      adminUserId: req.user._id,
    });

    res.json({
      message: "Data plan updated successfully",
      plan: serializeAdminDataPlan(plan),
    });
  } catch (error) {
    sendDataServiceError(res, "Could not update data plan", error);
  }
};

export const purchaseData = async (req, res) => {
  try {
    const result = await purchaseDataForUser({
      userId: req.user._id,
      planId: req.body?.planId,
      phone: req.body?.phone,
      transactionPin: req.body?.transactionPin,
    });

    res.status(201).json(serializeDataPurchaseResult(result));
  } catch (error) {
    sendDataServiceError(res, "Could not purchase data", error);
  }
};

export const getAdminDataSettings = async (req, res) => {
  try {
    const settings = await getOrCreateDataServiceSetting();

    res.json({
      settings: serializeDataServiceSetting(settings),
    });
  } catch (error) {
    sendDataServiceError(res, "Could not fetch data service settings", error);
  }
};

export const updateAdminDataSettings = async (req, res) => {
  try {
    const settings = await updateDataServiceSetting(req.body || {}, req.user._id);

    res.json({
      message: "Data service settings updated successfully",
      settings: serializeDataServiceSetting(settings),
    });
  } catch (error) {
    sendDataServiceError(res, "Could not update data service settings", error);
  }
};
