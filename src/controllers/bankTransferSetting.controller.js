import {
  getBankTransferSetting,
  serializeBankTransferSetting,
  updateBankTransferSetting,
} from "../services/bankTransferFee.service.js";

const sendError = (res, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode
      ? error.message
      : "Could not process bank transfer settings",
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

export const getAdminBankTransferSetting = async (req, res) => {
  try {
    const setting = await getBankTransferSetting();
    res.json({ setting: serializeBankTransferSetting(setting) });
  } catch (error) {
    sendError(res, error);
  }
};

export const updateAdminBankTransferSetting = async (req, res) => {
  try {
    const setting = await updateBankTransferSetting(
      req.body?.flatFee,
      req.user._id
    );
    res.json({
      message: "Bank transfer fee updated successfully",
      setting: serializeBankTransferSetting(setting),
    });
  } catch (error) {
    sendError(res, error);
  }
};
