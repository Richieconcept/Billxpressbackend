import {
  getCableTvPackagesForUser,
  getCableTvProvidersForUser,
  getOrCreateCableTvServiceSetting,
  purchaseCableTvForUser,
  quoteCableTvForUser,
  serializeCableTvPurchaseResult,
  serializeCableTvServiceSetting,
  serializeFailedCableTvPurchase,
  updateCableTvServiceSetting,
  verifyCableTvSmartcardForUser,
} from "../services/cableTvService.service.js";

const sendCableTvServiceError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
    ...serializeFailedCableTvPurchase(error),
  });
};

export const getCableTvProviders = async (req, res) => {
  try {
    const result = await getCableTvProvidersForUser(req.user);

    res.json({
      provider: result.provider,
      pricing: {
        userMarkupPercent: result.settings.userMarkupPercent,
        vendorMarkupPercent: result.settings.vendorMarkupPercent,
        appliedMarkupPercent: result.appliedMarkupPercent,
        roundingMode: result.settings.roundingMode,
      },
      tvProviders: result.tvProviders,
    });
  } catch (error) {
    sendCableTvServiceError(res, "Could not fetch cable TV providers", error);
  }
};

export const getCableTvPackages = async (req, res) => {
  try {
    const result = await getCableTvPackagesForUser({
      user: req.user,
      tvProvider: req.query?.provider || req.query?.tvProvider,
    });

    res.json(result);
  } catch (error) {
    sendCableTvServiceError(res, "Could not fetch cable TV packages", error);
  }
};

export const verifyCableTvSmartcard = async (req, res) => {
  try {
    const smartcard = await verifyCableTvSmartcardForUser({
      user: req.user,
      tvProvider: req.body?.provider || req.body?.tvProvider,
      smartcardNumber: req.body?.smartcardNumber,
    });
    const { raw, requestPayload, ...publicSmartcard } = smartcard;

    res.json({
      message: "Smartcard verified successfully",
      smartcard: publicSmartcard,
    });
  } catch (error) {
    sendCableTvServiceError(res, "Could not verify smartcard", error);
  }
};

export const quoteCableTv = async (req, res) => {
  try {
    const quote = await quoteCableTvForUser({
      user: req.user,
      tvProvider: req.body?.provider || req.body?.tvProvider,
      packageCode: req.body?.packageCode,
    });

    res.json({ quote });
  } catch (error) {
    sendCableTvServiceError(res, "Could not calculate cable TV price", error);
  }
};

export const purchaseCableTv = async (req, res) => {
  try {
    const result = await purchaseCableTvForUser({
      userId: req.user._id,
      tvProvider: req.body?.provider || req.body?.tvProvider,
      smartcardNumber: req.body?.smartcardNumber,
      packageCode: req.body?.packageCode,
      phone: req.body?.phone,
      subscriptionType: req.body?.subscriptionType,
      transactionPin: req.body?.transactionPin,
      customerReference: req.body?.customerReference,
    });

    res.status(201).json(serializeCableTvPurchaseResult(result));
  } catch (error) {
    sendCableTvServiceError(res, "Could not purchase cable TV", error);
  }
};

export const getAdminCableTvSettings = async (req, res) => {
  try {
    const settings = await getOrCreateCableTvServiceSetting();

    res.json({
      settings: serializeCableTvServiceSetting(settings),
    });
  } catch (error) {
    sendCableTvServiceError(
      res,
      "Could not fetch cable TV service settings",
      error
    );
  }
};

export const updateAdminCableTvSettings = async (req, res) => {
  try {
    const settings = await updateCableTvServiceSetting(
      req.body || {},
      req.user._id
    );

    res.json({
      message: "Cable TV service settings updated successfully",
      settings: serializeCableTvServiceSetting(settings),
    });
  } catch (error) {
    sendCableTvServiceError(
      res,
      "Could not update cable TV service settings",
      error
    );
  }
};
