import { fromMinorUnit } from "./wallet.service.js";

const readNumberEnv = (name, fallback = 0) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

export const getFundingFeeConfig = (provider) => {
  const prefix = provider.toUpperCase();

  return {
    flat: Math.max(0, Math.round(readNumberEnv(`${prefix}_FUNDING_FEE_FLAT`) * 100)),
    percent: Math.max(0, readNumberEnv(`${prefix}_FUNDING_FEE_PERCENT`, 1)),
  };
};

export const calculateFundingFee = (amountInMinorUnit, provider) => {
  const { flat, percent } = getFundingFeeConfig(provider);
  const percentAmount = Math.round((amountInMinorUnit * percent) / 100);
  const fee = Math.min(amountInMinorUnit, flat + percentAmount);
  const amountToReceive = amountInMinorUnit - fee;

  return {
    fee,
    amountToReceive,
    percent,
    flat,
  };
};

export const getFundingFeeMessage = (provider) => {
  const { flat, percent } = getFundingFeeConfig(provider);
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

  return `Funding fee is ${parts.join(" + ")} and is paid by the user. The wallet is credited with the amount after fee.`;
};

export const serializeFundingFee = (provider) => {
  const { flat, percent } = getFundingFeeConfig(provider);

  return {
    paidBy: "user",
    percent,
    flat: fromMinorUnit(flat),
    message: getFundingFeeMessage(provider),
  };
};
