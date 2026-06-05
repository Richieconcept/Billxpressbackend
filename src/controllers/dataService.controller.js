import {
  getDataPlansForUser,
  getOrCreateDataServiceSetting,
  purchaseDataForUser,
  serializeDataPurchaseResult,
  serializeDataServiceSetting,
  serializeFailedDataPurchase,
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
    const result = await getDataPlansForUser(req.user);

    res.json({
      provider: result.provider,
      pricing: {
        userMarkupPercent: result.settings.userMarkupPercent,
        vendorMarkupPercent: result.settings.vendorMarkupPercent,
        appliedMarkupPercent:
          req.user.role === "vendor" && req.user.isVendorActive
            ? result.settings.vendorMarkupPercent
            : result.settings.userMarkupPercent,
        roundingMode: result.settings.roundingMode,
      },
      plans: result.plans,
      count: result.plans.length,
    });
  } catch (error) {
    sendDataServiceError(res, "Could not fetch data plans", error);
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
