import { fromMinorUnit } from "./wallet.service.js";
import FundingFeeSetting from "../models/fundingFeeSetting.model.js";
import FundingProviderSetting from "../models/fundingProviderSetting.model.js";

const SUPPORTED_FUNDING_PROVIDERS = ["pocketfi", "monnify", "maplerad"];
const SUPPORTED_ONE_TIME_PROVIDERS = ["monnify", "maplerad"];

const readNumberEnv = (name, fallback = 0) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const normalizeProvider = (provider) => {
  const normalizedProvider = String(provider || "").trim().toLowerCase();

  if (!SUPPORTED_FUNDING_PROVIDERS.includes(normalizedProvider)) {
    const error = new Error("Funding provider is not supported");
    error.statusCode = 400;
    throw error;
  }

  return normalizedProvider;
};

const getEnvFundingFeeConfig = (provider) => {
  const prefix = provider.toUpperCase();

  return {
    flat: Math.max(0, Math.round(readNumberEnv(`${prefix}_FUNDING_FEE_FLAT`) * 100)),
    percent: Math.max(0, readNumberEnv(`${prefix}_FUNDING_FEE_PERCENT`, 1)),
    creditPolicy: "gross",
  };
};

export const getOrCreateFundingFeeSetting = async (provider) => {
  const normalizedProvider = normalizeProvider(provider);
  let setting = await FundingFeeSetting.findOne({ provider: normalizedProvider });

  if (!setting) {
    const envConfig = getEnvFundingFeeConfig(normalizedProvider);
    setting = await FundingFeeSetting.create({
      provider: normalizedProvider,
      percent: envConfig.percent,
      flat: envConfig.flat,
      creditPolicy: "gross",
    });
  }

  return setting;
};

export const getFundingFeeConfig = async (provider) => {
  const setting = await getOrCreateFundingFeeSetting(provider);

  return {
    flat: Math.max(0, Math.round(Number(setting.flat) || 0)),
    percent: Math.max(0, Number(setting.percent) || 0),
    creditPolicy: "gross",
  };
};

export const listFundingFeeSettings = async () => {
  const providers = SUPPORTED_FUNDING_PROVIDERS;
  const settings = await Promise.all(
    providers.map((provider) => getOrCreateFundingFeeSetting(provider))
  );

  return settings;
};

export const getOneTimeFundingProvider = async () => {
  let setting = await FundingProviderSetting.findOne({ key: "one_time_funding" });

  if (!setting) {
    const envProvider = String(
      process.env.ONE_TIME_FUNDING_PROVIDER || "maplerad"
    )
      .trim()
      .toLowerCase();
    setting = await FundingProviderSetting.create({
      key: "one_time_funding",
      provider: SUPPORTED_ONE_TIME_PROVIDERS.includes(envProvider)
        ? envProvider
        : "maplerad",
    });
  }

  return setting.provider;
};

export const getFundingProviderSettings = async () => ({
  oneTimeFundingProvider: await getOneTimeFundingProvider(),
});

export const updateOneTimeFundingProvider = async (provider, adminUserId) => {
  const normalizedProvider = String(provider || "").trim().toLowerCase();

  if (!SUPPORTED_ONE_TIME_PROVIDERS.includes(normalizedProvider)) {
    const error = new Error("One-time funding provider is not supported");
    error.statusCode = 400;
    throw error;
  }

  const setting = await FundingProviderSetting.findOneAndUpdate(
    { key: "one_time_funding" },
    {
      provider: normalizedProvider,
      updatedBy: adminUserId,
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  return setting.provider;
};

export const updateFundingFeeSetting = async (payload, adminUserId) => {
  const provider = normalizeProvider(payload?.provider);
  const setting = await getOrCreateFundingFeeSetting(provider);

  if (payload.percent !== undefined) {
    const percent = Number(payload.percent);

    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      const error = new Error("Funding fee percent must be between 0 and 100");
      error.statusCode = 400;
      throw error;
    }

    setting.percent = percent;
  }

  if (payload.flat !== undefined) {
    const flat = Number(payload.flat);

    if (!Number.isFinite(flat) || flat < 0) {
      const error = new Error("Funding fee flat amount must be zero or greater");
      error.statusCode = 400;
      throw error;
    }

    setting.flat = Math.round(flat * 100);
  }

  setting.creditPolicy = "gross";
  setting.updatedBy = adminUserId;
  await setting.save();

  return setting;
};

export const calculateFundingFee = async (amountInMinorUnit, provider) => {
  const { flat, percent } = await getFundingFeeConfig(provider);
  const percentAmount = Math.round((amountInMinorUnit * percent) / 100);
  const fee = Math.min(amountInMinorUnit, flat + percentAmount);
  const amountToReceive = amountInMinorUnit;

  return {
    fee,
    amountToReceive,
    percent,
    flat,
    creditPolicy: "gross",
  };
};

export const getFundingFeeMessage = ({ flat, percent }) => {
  const parts = [];

  if (percent > 0) {
    parts.push(`${percent}%`);
  }

  if (flat > 0) {
    parts.push(`NGN ${fromMinorUnit(flat)}`);
  }

  if (parts.length === 0) {
    return "No funding fee is currently applied.";
  }

  return `Funding charge is ${parts.join(" + ")}. The user wallet is credited with the full transferred amount.`;
};

export const serializeFundingFeeConfig = (setting) => ({
  provider: setting.provider,
  percent: Number(setting.percent) || 0,
  flat: fromMinorUnit(setting.flat || 0),
  creditPolicy: "gross",
  paidBy: "platform",
  userReceivesFullAmount: true,
  message: getFundingFeeMessage({
    flat: setting.flat || 0,
    percent: Number(setting.percent) || 0,
  }),
  updatedBy: setting.updatedBy,
  createdAt: setting.createdAt,
  updatedAt: setting.updatedAt,
});

export const serializeFundingFee = async (provider) => {
  const { flat, percent } = await getFundingFeeConfig(provider);

  return {
    paidBy: "platform",
    percent,
    flat: fromMinorUnit(flat),
    creditPolicy: "gross",
    userReceivesFullAmount: true,
    message: getFundingFeeMessage({ flat, percent }),
  };
};
