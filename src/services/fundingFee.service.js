import { fromMinorUnit } from "./wallet.service.js";
import FundingFeeSetting from "../models/fundingFeeSetting.model.js";
import FundingProviderSetting from "../models/fundingProviderSetting.model.js";

const SUPPORTED_FUNDING_PROVIDERS = [
  "pocketfi",
  "monnify",
  "maplerad",
  "flutterwave",
];
const SUPPORTED_ONE_TIME_PROVIDERS = ["monnify", "maplerad", "flutterwave"];

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
    cap: Math.max(0, Math.round(readNumberEnv(`${prefix}_FUNDING_FEE_CAP`) * 100)),
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
      cap: envConfig.cap,
      creditPolicy: envConfig.creditPolicy,
    });
  }

  return setting;
};

export const getFundingFeeConfig = async (provider) => {
  const setting = await getOrCreateFundingFeeSetting(provider);

  return {
    flat: Math.max(0, Math.round(Number(setting.flat) || 0)),
    percent: Math.max(0, Number(setting.percent) || 0),
    cap: Math.max(0, Math.round(Number(setting.cap) || 0)),
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

  if (payload.cap !== undefined) {
    const cap = Number(payload.cap);

    if (!Number.isFinite(cap) || cap < 0) {
      const error = new Error("Funding fee cap must be zero or greater");
      error.statusCode = 400;
      throw error;
    }

    setting.cap = Math.round(cap * 100);
  }

  if (payload.creditPolicy !== undefined) {
    const creditPolicy = String(payload.creditPolicy).trim().toLowerCase();

    if (creditPolicy !== "gross") {
      const error = new Error(
        "Pay-in fees are paid by the platform; credit policy must be gross"
      );
      error.statusCode = 400;
      throw error;
    }
  }

  setting.creditPolicy = "gross";
  setting.updatedBy = adminUserId;
  await setting.save();

  return setting;
};

export const calculateFundingFee = async (amountInMinorUnit, provider) => {
  const { flat, percent, cap, creditPolicy } =
    await getFundingFeeConfig(provider);
  const percentAmount = Math.round((amountInMinorUnit * percent) / 100);
  const uncappedFee = flat + percentAmount;
  const cappedFee = cap > 0 ? Math.min(uncappedFee, cap) : uncappedFee;
  const fee = Math.min(amountInMinorUnit, cappedFee);
  const amountToReceive =
    creditPolicy === "net" ? amountInMinorUnit - fee : amountInMinorUnit;

  return {
    fee,
    amountToReceive,
    percent,
    flat,
    cap,
    creditPolicy,
  };
};

export const getFundingFeeMessage = ({ flat, percent, cap, creditPolicy }) => {
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

  const capMessage = cap > 0 ? `, capped at NGN ${fromMinorUnit(cap)}` : "";
  const creditMessage =
    creditPolicy === "net"
      ? "The charge is deducted from the transfer before the wallet is credited."
      : "The user wallet is credited with the full transferred amount.";

  return `Funding charge is ${parts.join(" + ")}${capMessage}. ${creditMessage}`;
};

export const serializeFundingFeeConfig = (setting) => ({
  provider: setting.provider,
  percent: Number(setting.percent) || 0,
  flat: fromMinorUnit(setting.flat || 0),
  cap: fromMinorUnit(setting.cap || 0),
  creditPolicy: "gross",
  paidBy: "platform",
  userReceivesFullAmount: true,
  message: getFundingFeeMessage({
    flat: setting.flat || 0,
    percent: Number(setting.percent) || 0,
    cap: setting.cap || 0,
    creditPolicy: "gross",
  }),
  updatedBy: setting.updatedBy,
  createdAt: setting.createdAt,
  updatedAt: setting.updatedAt,
});

export const serializeFundingFee = async (provider) => {
  const { flat, percent, cap, creditPolicy } =
    await getFundingFeeConfig(provider);

  return {
    paidBy: creditPolicy === "net" ? "user" : "platform",
    percent,
    flat: fromMinorUnit(flat),
    cap: fromMinorUnit(cap),
    creditPolicy,
    userReceivesFullAmount: creditPolicy !== "net",
    message: getFundingFeeMessage({ flat, percent, cap, creditPolicy }),
  };
};
