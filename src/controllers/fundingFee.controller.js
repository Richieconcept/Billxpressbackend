import {
  listFundingFeeSettings,
  getFundingProviderSettings,
  serializeFundingFeeConfig,
  updateOneTimeFundingProvider,
  updateFundingFeeSetting,
} from "../services/fundingFee.service.js";
import { getMapleradInstitutions } from "../services/maplerad.service.js";

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
      providerSettings: await getFundingProviderSettings(),
      settings: settings.map((setting) => serializeFundingFeeConfig(setting)),
    });
  } catch (error) {
    sendFundingFeeError(res, "Could not fetch funding fee settings", error);
  }
};

export const updateAdminFundingFeeSetting = async (req, res) => {
  try {
    if (req.body?.oneTimeFundingProvider !== undefined) {
      const oneTimeFundingProvider = await updateOneTimeFundingProvider(
        req.body.oneTimeFundingProvider,
        req.user._id
      );

      return res.json({
        message: "One-time funding provider updated successfully",
        providerSettings: {
          oneTimeFundingProvider,
        },
      });
    }

    const setting = await updateFundingFeeSetting(req.body, req.user._id);

    res.json({
      message: "Funding fee setting updated successfully",
      setting: serializeFundingFeeConfig(setting),
    });
  } catch (error) {
    sendFundingFeeError(res, "Could not update funding fee setting", error);
  }
};

export const getAdminMapleradInstitutions = async (req, res) => {
  try {
    const result = await getMapleradInstitutions({
      country: req.query.country || "NG",
      type: req.query.type || "DYNAMIC",
      page: req.query.page || 1,
      pageSize: req.query.pageSize || req.query.page_size || 100,
    });

    res.json({
      country: result.country,
      type: result.type,
      institutions: result.institutions.map(({ name, code }) => ({
        name,
        code,
      })),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    });
  } catch (error) {
    sendFundingFeeError(res, "Could not fetch Maplerad institutions", error);
  }
};
