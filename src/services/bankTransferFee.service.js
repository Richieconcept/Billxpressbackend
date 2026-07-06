import BankTransferSetting from "../models/bankTransferSetting.model.js";
import { fromMinorUnit, toMinorUnit } from "./wallet.service.js";

const SETTING_KEY = "maplerad_ngn_payout";

const getDefaultFee = () => {
  const configuredFee = Number(process.env.MAPLERAD_PAYOUT_FEE ?? 25);
  return Number.isFinite(configuredFee) && configuredFee >= 0
    ? Math.round(configuredFee * 100)
    : 2500;
};

export const getBankTransferSetting = async () => {
  let setting = await BankTransferSetting.findOne({ key: SETTING_KEY });

  if (!setting) {
    setting = await BankTransferSetting.create({
      key: SETTING_KEY,
      flatFee: getDefaultFee(),
    });
  }

  return setting;
};

export const getBankTransferQuote = async (amount) => {
  const amountInMinorUnit = toMinorUnit(amount);
  const setting = await getBankTransferSetting();
  const feeInMinorUnit = Math.max(0, Math.round(Number(setting.flatFee) || 0));

  return {
    amountInMinorUnit,
    feeInMinorUnit,
    totalDebitInMinorUnit: amountInMinorUnit + feeInMinorUnit,
  };
};

export const serializeBankTransferQuote = (quote) => ({
  transferAmount: fromMinorUnit(quote.amountInMinorUnit),
  fee: fromMinorUnit(quote.feeInMinorUnit),
  totalWalletDebit: fromMinorUnit(quote.totalDebitInMinorUnit),
  recipientReceives: fromMinorUnit(quote.amountInMinorUnit),
  currency: "NGN",
});

export const serializeBankTransferSetting = (setting) => ({
  provider: "maplerad",
  currency: "NGN",
  channel: "NIP",
  flatFee: fromMinorUnit(setting.flatFee),
  providerFee: 20,
  updatedBy: setting.updatedBy,
  createdAt: setting.createdAt,
  updatedAt: setting.updatedAt,
});

export const updateBankTransferSetting = async (flatFee, adminUserId) => {
  const numericFee = Number(flatFee);

  if (!Number.isFinite(numericFee) || numericFee < 0) {
    const error = new Error("Bank transfer fee must be zero or greater");
    error.statusCode = 400;
    throw error;
  }

  const setting = await getBankTransferSetting();
  setting.flatFee = Math.round(numericFee * 100);
  setting.updatedBy = adminUserId;
  await setting.save();
  return setting;
};
