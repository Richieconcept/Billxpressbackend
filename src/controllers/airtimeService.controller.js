import {
  getAirtimeNetworksForUser,
  getOrCreateAirtimeServiceSetting,
  purchaseAirtimeForUser,
  quoteAirtimeForUser,
  serializeAirtimePurchaseResult,
  serializeAirtimeServiceSetting,
  serializeFailedAirtimePurchase,
  updateAirtimeServiceSetting,
} from "../services/airtimeService.service.js";

const sendAirtimeServiceError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
    ...serializeFailedAirtimePurchase(error),
  });
};

export const getAirtimeNetworks = async (req, res) => {
  try {
    const result = await getAirtimeNetworksForUser(req.user);

    res.json({
      provider: result.provider,
      pricing: {
        userMarkupPercent: result.settings.userMarkupPercent,
        vendorMarkupPercent: result.settings.vendorMarkupPercent,
        appliedMarkupPercent: result.appliedMarkupPercent,
        roundingMode: result.settings.roundingMode,
        minimumAmount: result.settings.minimumAmount,
        maximumAmount: result.settings.maximumAmount,
      },
      networks: result.networks,
    });
  } catch (error) {
    sendAirtimeServiceError(res, "Could not fetch airtime networks", error);
  }
};

export const quoteAirtime = async (req, res) => {
  try {
    const quote = await quoteAirtimeForUser({
      user: req.user,
      amount: req.body?.amount,
    });

    res.json({ quote });
  } catch (error) {
    sendAirtimeServiceError(res, "Could not calculate airtime price", error);
  }
};

export const purchaseAirtime = async (req, res) => {
  try {
    const result = await purchaseAirtimeForUser({
      userId: req.user._id,
      network: req.body?.network,
      phone: req.body?.phone,
      amount: req.body?.amount,
      transactionPin: req.body?.transactionPin,
    });

    res.status(201).json(serializeAirtimePurchaseResult(result));
  } catch (error) {
    sendAirtimeServiceError(res, "Could not purchase airtime", error);
  }
};

export const getAdminAirtimeSettings = async (req, res) => {
  try {
    const settings = await getOrCreateAirtimeServiceSetting();

    res.json({
      settings: serializeAirtimeServiceSetting(settings),
    });
  } catch (error) {
    sendAirtimeServiceError(
      res,
      "Could not fetch airtime service settings",
      error
    );
  }
};

export const updateAdminAirtimeSettings = async (req, res) => {
  try {
    const settings = await updateAirtimeServiceSetting(
      req.body || {},
      req.user._id
    );

    res.json({
      message: "Airtime service settings updated successfully",
      settings: serializeAirtimeServiceSetting(settings),
    });
  } catch (error) {
    sendAirtimeServiceError(
      res,
      "Could not update airtime service settings",
      error
    );
  }
};
