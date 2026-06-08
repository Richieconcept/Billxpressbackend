import {
  listFundingFeeSettings,
  serializeFundingFeeConfig,
  updateFundingFeeSetting,
} from "../services/fundingFee.service.js";

const sendFundingFeeError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

export const getAdminFundingFeeSettings = async (req, res) => {
  try {
    const settings = await listFundingFeeSettings();

    res.json({
      settings: settings.map((setting) => serializeFundingFeeConfig(setting)),
    });
  } catch (error) {
    sendFundingFeeError(res, "Could not fetch funding fee settings", error);
  }
};

export const updateAdminFundingFeeSetting = async (req, res) => {
  try {
    const setting = await updateFundingFeeSetting(req.body, req.user._id);

    res.json({
      message: "Funding fee setting updated successfully",
      setting: serializeFundingFeeConfig(setting),
    });
  } catch (error) {
    sendFundingFeeError(res, "Could not update funding fee setting", error);
  }
};
