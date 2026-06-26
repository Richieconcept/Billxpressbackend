import {
  getElectricityDiscosForUser,
  getOrCreateElectricityServiceSetting,
  purchaseElectricityForUser,
  quoteElectricityForUser,
  serializeElectricityPurchaseResult,
  serializeElectricityServiceSetting,
  serializeFailedElectricityPurchase,
  updateElectricityServiceSetting,
  verifyElectricityMeterForUser,
} from "../services/electricityService.service.js";

const sendElectricityServiceError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
    ...serializeFailedElectricityPurchase(error),
  });
};

export const getElectricityDiscos = async (req, res) => {
  try {
    const result = await getElectricityDiscosForUser(req.user);

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
      discos: result.discos,
    });
  } catch (error) {
    sendElectricityServiceError(res, "Could not fetch electricity providers", error);
  }
};

export const verifyElectricityMeter = async (req, res) => {
  try {
    const meter = await verifyElectricityMeterForUser({
      user: req.user,
      disco: req.body?.disco,
      meterNumber: req.body?.meterNumber,
      meterType: req.body?.meterType,
    });
    const { raw, requestPayload, ...publicMeter } = meter;

    res.json({
      message: "Meter verified successfully",
      meter: publicMeter,
    });
  } catch (error) {
    sendElectricityServiceError(res, "Could not verify meter", error);
  }
};

export const quoteElectricity = async (req, res) => {
  try {
    const quote = await quoteElectricityForUser({
      user: req.user,
      amount: req.body?.amount,
    });

    res.json({ quote });
  } catch (error) {
    sendElectricityServiceError(res, "Could not calculate electricity price", error);
  }
};

export const purchaseElectricity = async (req, res) => {
  try {
    const result = await purchaseElectricityForUser({
      userId: req.user._id,
      disco: req.body?.disco,
      meterNumber: req.body?.meterNumber,
      meterType: req.body?.meterType,
      phone: req.body?.phone,
      amount: req.body?.amount,
      transactionPin: req.body?.transactionPin,
      customerReference: req.body?.customerReference,
    });

    res.status(201).json(serializeElectricityPurchaseResult(result));
  } catch (error) {
    sendElectricityServiceError(res, "Could not purchase electricity", error);
  }
};

export const getAdminElectricitySettings = async (req, res) => {
  try {
    const settings = await getOrCreateElectricityServiceSetting();

    res.json({
      settings: serializeElectricityServiceSetting(settings),
    });
  } catch (error) {
    sendElectricityServiceError(
      res,
      "Could not fetch electricity service settings",
      error
    );
  }
};

export const updateAdminElectricitySettings = async (req, res) => {
  try {
    const settings = await updateElectricityServiceSetting(
      req.body || {},
      req.user._id
    );

    res.json({
      message: "Electricity service settings updated successfully",
      settings: serializeElectricityServiceSetting(settings),
    });
  } catch (error) {
    sendElectricityServiceError(
      res,
      "Could not update electricity service settings",
      error
    );
  }
};
