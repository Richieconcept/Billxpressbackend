import mongoose from "mongoose";
import CardQuote from "../models/cardQuote.model.js";
import CardSetting from "../models/cardSetting.model.js";
import MapleradCustomer from "../models/mapleradCustomer.model.js";
import Transaction from "../models/transaction.model.js";
import User from "../models/user.model.js";
import VirtualDollarCard from "../models/virtualDollarCard.model.js";
import {
  createMapleradCard,
  exchangeMapleradCurrency,
  freezeMapleradCard,
  fundMapleradCard,
  generateMapleradFxQuote,
  getMapleradCard,
  getMapleradCardTransactions,
  unfreezeMapleradCard,
  withdrawMapleradCard,
} from "./maplerad.service.js";
import {
  creditWallet,
  debitWallet,
  fromMinorUnit,
  generateTransactionReference,
  getOrCreateWallet,
  serializeTransaction,
  serializeWallet,
  toMinorUnit,
  verifyTransactionPin,
} from "./wallet.service.js";
import { createNotificationBestEffort } from "./notification.service.js";
import { getPublicProviderFailure } from "./providerFailure.service.js";

const SUPPORTED_BRANDS = ["VISA", "MASTERCARD"];

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const calculateFee = (amount, config = {}) =>
  Math.max(
    0,
    Math.round(
      (amount * (Number(config.percent) || 0)) / 100 +
        (Number(config.flat) || 0)
    )
  );

const calculateTieredFee = (amount, config = {}) => {
  const thresholdAmount = Number(config.thresholdAmount) || 0;

  if (thresholdAmount > 0) {
    if (amount < thresholdAmount) {
      return Math.max(0, Math.round(Number(config.belowThresholdFlat) || 0));
    }

    return Math.max(
      0,
      Math.round((amount * (Number(config.aboveThresholdPercent) || 0)) / 100)
    );
  }

  return calculateFee(amount, config);
};

const serializeFee = (fee = {}) => ({
  percent: Number(fee.percent) || 0,
  flat: fromMinorUnit(Number(fee.flat) || 0),
  thresholdAmount: fromMinorUnit(Number(fee.thresholdAmount) || 0),
  belowThresholdFlat: fromMinorUnit(Number(fee.belowThresholdFlat) || 0),
  aboveThresholdPercent: Number(fee.aboveThresholdPercent) || 0,
});

export const getOrCreateCardSetting = async () => {
  let setting = await CardSetting.findOne({ service: "virtual_dollar_card" });

  if (!setting) {
    setting = await CardSetting.create({});
  }

  return setting;
};

export const serializeCardSetting = (setting) => ({
  isEnabled: setting.isEnabled,
  allowedBrands: setting.allowedBrands,
  defaultBrand: setting.defaultBrand,
  creationFee: {
    ...serializeFee(setting.creationFee),
    currency: "NGN",
    deprecated: true,
  },
  creationFeeUsd: {
    ...serializeFee(setting.creationFeeUsd),
    currency: "USD",
  },
  providerCreationFee: serializeFee(setting.providerCreationFee),
  fundingFee: serializeFee(setting.fundingFee),
  withdrawalFee: serializeFee(setting.withdrawalFee),
  crossBorderFee: serializeFee(setting.crossBorderFee),
  chargebackFee: serializeFee(setting.chargebackFee),
  declineFee: serializeFee(setting.declineFee),
  fundingExchangeMarkupPercent: setting.fundingExchangeMarkupPercent,
  withdrawalExchangeMarkupPercent: setting.withdrawalExchangeMarkupPercent,
  monthlyMaintenanceFee: fromMinorUnit(setting.monthlyMaintenanceFee),
  maintenanceGracePeriodDays: setting.maintenanceGracePeriodDays,
  freezeOnMaintenanceFailure: setting.freezeOnMaintenanceFailure,
  minimumFundingAmount: fromMinorUnit(setting.minimumFundingAmount),
  maximumFundingAmount: fromMinorUnit(setting.maximumFundingAmount),
  minimumWithdrawalAmount: fromMinorUnit(setting.minimumWithdrawalAmount),
  quoteTtlSeconds: setting.quoteTtlSeconds,
  updatedBy: setting.updatedBy,
  updatedAt: setting.updatedAt,
});

const updateFee = (setting, field, payload) => {
  if (payload === undefined) return;

  const percent = Number(payload?.percent);
  const flat = Number(payload?.flat);
  const thresholdAmount =
    payload?.thresholdAmount === undefined
      ? 0
      : Number(payload.thresholdAmount);
  const belowThresholdFlat =
    payload?.belowThresholdFlat === undefined
      ? 0
      : Number(payload.belowThresholdFlat);
  const aboveThresholdPercent =
    payload?.aboveThresholdPercent === undefined
      ? 0
      : Number(payload.aboveThresholdPercent);

  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw badRequest(`${field} percent must be between 0 and 100`);
  }

  if (!Number.isFinite(flat) || flat < 0) {
    throw badRequest(`${field} flat amount must be zero or greater`);
  }

  if (!Number.isFinite(thresholdAmount) || thresholdAmount < 0) {
    throw badRequest(`${field} threshold amount must be zero or greater`);
  }

  if (!Number.isFinite(belowThresholdFlat) || belowThresholdFlat < 0) {
    throw badRequest(
      `${field} below-threshold flat amount must be zero or greater`
    );
  }

  if (
    !Number.isFinite(aboveThresholdPercent) ||
    aboveThresholdPercent < 0 ||
    aboveThresholdPercent > 100
  ) {
    throw badRequest(
      `${field} above-threshold percent must be between 0 and 100`
    );
  }

  setting[field] = {
    percent,
    flat: Math.round(flat * 100),
    thresholdAmount: Math.round(thresholdAmount * 100),
    belowThresholdFlat: Math.round(belowThresholdFlat * 100),
    aboveThresholdPercent,
  };
};

const setPercent = (setting, payload, field) => {
  if (payload[field] === undefined) return;
  const value = Number(payload[field]);

  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw badRequest(`${field} must be between 0 and 100`);
  }

  setting[field] = value;
};

const setMoney = (setting, payload, field, { minimum = 0 } = {}) => {
  if (payload[field] === undefined) return;
  const value = Number(payload[field]);

  if (!Number.isFinite(value) || value < minimum) {
    throw badRequest(`${field} must be ${minimum} or greater`);
  }

  setting[field] = Math.round(value * 100);
};

export const updateCardSetting = async (payload, adminUserId) => {
  const setting = await getOrCreateCardSetting();

  if (payload.isEnabled !== undefined) {
    setting.isEnabled = Boolean(payload.isEnabled);
  }

  if (payload.allowedBrands !== undefined) {
    if (!Array.isArray(payload.allowedBrands)) {
      throw badRequest("allowedBrands must be an array");
    }

    const brands = [...new Set(payload.allowedBrands.map((brand) =>
      String(brand).trim().toUpperCase()
    ))];

    if (
      brands.length === 0 ||
      brands.some((brand) => !SUPPORTED_BRANDS.includes(brand))
    ) {
      throw badRequest("allowedBrands must contain VISA or MASTERCARD");
    }

    setting.allowedBrands = brands;
  }

  if (payload.defaultBrand !== undefined) {
    const brand = String(payload.defaultBrand).trim().toUpperCase();

    if (!SUPPORTED_BRANDS.includes(brand)) {
      throw badRequest("defaultBrand must be VISA or MASTERCARD");
    }

    setting.defaultBrand = brand;
  }

  updateFee(setting, "creationFee", payload.creationFee);
  updateFee(setting, "creationFeeUsd", payload.creationFeeUsd);
  updateFee(setting, "providerCreationFee", payload.providerCreationFee);
  updateFee(setting, "fundingFee", payload.fundingFee);
  updateFee(setting, "withdrawalFee", payload.withdrawalFee);
  updateFee(setting, "crossBorderFee", payload.crossBorderFee);
  updateFee(setting, "chargebackFee", payload.chargebackFee);
  updateFee(setting, "declineFee", payload.declineFee);
  setPercent(setting, payload, "fundingExchangeMarkupPercent");
  setPercent(setting, payload, "withdrawalExchangeMarkupPercent");
  setMoney(setting, payload, "monthlyMaintenanceFee");
  setMoney(setting, payload, "minimumFundingAmount", { minimum: 0.01 });
  setMoney(setting, payload, "maximumFundingAmount", { minimum: 0.01 });
  setMoney(setting, payload, "minimumWithdrawalAmount", { minimum: 0.01 });

  if (payload.maintenanceGracePeriodDays !== undefined) {
    const days = Number(payload.maintenanceGracePeriodDays);
    if (!Number.isInteger(days) || days < 0 || days > 31) {
      throw badRequest("maintenanceGracePeriodDays must be between 0 and 31");
    }
    setting.maintenanceGracePeriodDays = days;
  }

  if (payload.freezeOnMaintenanceFailure !== undefined) {
    setting.freezeOnMaintenanceFailure = Boolean(
      payload.freezeOnMaintenanceFailure
    );
  }

  if (payload.quoteTtlSeconds !== undefined) {
    const seconds = Number(payload.quoteTtlSeconds);
    if (!Number.isInteger(seconds) || seconds < 30 || seconds > 1800) {
      throw badRequest("quoteTtlSeconds must be between 30 and 1800");
    }
    setting.quoteTtlSeconds = seconds;
  }

  if (setting.maximumFundingAmount < setting.minimumFundingAmount) {
    throw badRequest("Maximum funding amount cannot be below the minimum");
  }

  if (!setting.allowedBrands.includes(setting.defaultBrand)) {
    throw badRequest("defaultBrand must be included in allowedBrands");
  }

  setting.updatedBy = adminUserId;
  await setting.save();
  return setting;
};

export const serializeCard = (card) => ({
  id: card._id,
  brand: card.brand,
  currency: card.currency,
  type: card.type,
  status: card.status,
  name: card.name,
  maskedPan: card.maskedPan,
  balance: fromMinorUnit(card.balance || 0),
  nextMaintenanceAt: card.nextMaintenanceAt,
  lastMaintenanceAt: card.lastMaintenanceAt,
  maintenancePastDue: card.maintenancePastDue,
  maintenanceGraceEndsAt: card.maintenanceGraceEndsAt,
  frozenForMaintenance: card.frozenForMaintenance,
  maintenanceStatus: card.frozenForMaintenance
    ? "FROZEN_FOR_MAINTENANCE"
    : card.maintenancePastDue
      ? "PAYMENT_DUE"
      : "CURRENT",
  lastMaintenanceFailure: card.lastMaintenanceFailure,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
});

export const serializeCardQuote = (quote) => {
  const pricing = quote.pricingSnapshot || {};
  const sourceAmount = fromMinorUnit(quote.sourceAmount);
  const targetAmount = fromMinorUnit(quote.targetAmount);
  const billxpressCreationFee =
    Number(pricing.billxpressCreationFee) || 0;
  const billxpressCreationFeeUsd =
    Number(pricing.billxpressCreationFeeUsd) || 0;
  const providerCreationFeeUsd =
    Number(pricing.providerCreationFeeUsd) || 0;
  const totalCreationFeeUsd =
    billxpressCreationFeeUsd + providerCreationFeeUsd;
  const providerCreationFee = Number(pricing.providerCreationFee) || 0;
  const billxpressFundingFee = Number(pricing.billxpressFundingFee) || 0;
  const providerFundingFee = Number(pricing.providerFundingFee) || 0;
  const hasDetailedCreationFees =
    pricing.billxpressCreationFee !== undefined ||
    pricing.providerCreationFee !== undefined;
  const hasDetailedFundingFees =
    pricing.billxpressFundingFee !== undefined ||
    pricing.providerFundingFee !== undefined;
  const creationFee = hasDetailedCreationFees
    ? billxpressCreationFee + providerCreationFee
    : quote.operation === "creation"
      ? Number(quote.fee) || 0
      : 0;
  const fundingFee = hasDetailedFundingFees
    ? billxpressFundingFee + providerFundingFee
    : quote.operation === "funding"
      ? Number(quote.fee) || 0
      : 0;
  const isFundingDirection =
    quote.sourceCurrency === "NGN" && quote.targetCurrency === "USD";
  const isWithdrawalDirection =
    quote.sourceCurrency === "USD" && quote.targetCurrency === "NGN";
  const customerExchangeRate =
    isFundingDirection && quote.targetAmount > 0
      ? Number(
          (
            (quote.sourceAmount + quote.exchangeMarkup) /
            quote.targetAmount
          ).toFixed(2)
        )
      : isWithdrawalDirection && quote.sourceAmount > 0
        ? Number(
            (
              (quote.targetAmount - quote.exchangeMarkup) /
              quote.sourceAmount
            ).toFixed(2)
          )
        : undefined;
  const serializedCustomerRate = customerExchangeRate
    ? {
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        value: customerExchangeRate,
        includesMarkup: true,
        display: isWithdrawalDirection
          ? `1 USD pays NGN ${customerExchangeRate}`
          : `1 USD = NGN ${customerExchangeRate}`,
      }
    : null;

  return {
    id: quote._id,
    operation: quote.operation,
    cardId: quote.card || undefined,
    brand: quote.brand,
    source: {
      currency: quote.sourceCurrency,
      amount: sourceAmount,
    },
    target: {
      currency: quote.targetCurrency,
      amount: targetAmount,
    },
    exchangeRate: serializedCustomerRate,
    fee: fromMinorUnit(quote.fee),
    feeBreakdown: {
      providerFee: fromMinorUnit(Number(pricing.providerFee) || 0),
      billxpressFee: fromMinorUnit(Number(pricing.billxpressFee) || 0),
    },
    exchangeMarkup: fromMinorUnit(quote.exchangeMarkup),
    walletDebit:
      quote.walletDebit > 0 ? fromMinorUnit(quote.walletDebit) : undefined,
    walletCredit:
      quote.walletCredit > 0 ? fromMinorUnit(quote.walletCredit) : undefined,
    summary:
      quote.operation === "creation"
        ? {
            cardBrand: quote.brand,
            amountEntered: {
              currency: quote.sourceCurrency,
              amount: sourceAmount,
            },
            amountToCard: {
              currency: quote.targetCurrency,
              amount: targetAmount,
            },
            exchangeRate: serializedCustomerRate,
            charges: {
              cardCreationFee: fromMinorUnit(creationFee),
              cardCreationFeeUsd: fromMinorUnit(
                totalCreationFeeUsd
              ),
              billxpressCardCreationFeeUsd: fromMinorUnit(
                billxpressCreationFeeUsd
              ),
              providerCardCreationFeeUsd: fromMinorUnit(
                providerCreationFeeUsd
              ),
              initialFundingFee: fromMinorUnit(fundingFee),
              exchangeMarkup: fromMinorUnit(quote.exchangeMarkup),
              total: fromMinorUnit(
                creationFee + fundingFee + quote.exchangeMarkup
              ),
            },
            totalWalletDebit: {
              currency: "NGN",
              amount: fromMinorUnit(quote.walletDebit),
            },
          }
        : quote.operation === "funding"
          ? {
              cardId: quote.card,
              amountEntered: {
                currency: quote.sourceCurrency,
                amount: sourceAmount,
              },
              amountToCard: {
                currency: quote.targetCurrency,
                amount: targetAmount,
              },
              exchangeRate: serializedCustomerRate,
              charges: {
                fundingFee: fromMinorUnit(fundingFee),
                exchangeMarkup: fromMinorUnit(quote.exchangeMarkup),
                total: fromMinorUnit(fundingFee + quote.exchangeMarkup),
              },
              totalWalletDebit: {
                currency: "NGN",
                amount: fromMinorUnit(quote.walletDebit),
              },
            }
          : undefined,
    status: quote.status,
    expiresAt: quote.expiresAt,
  };
};

const requireCardService = async () => {
  const setting = await getOrCreateCardSetting();

  if (!setting.isEnabled) {
    const error = new Error("Virtual dollar cards are currently unavailable");
    error.statusCode = 503;
    throw error;
  }

  return setting;
};

const requireEligibleCustomer = async (userId) => {
  const customer = await MapleradCustomer.findOne({ user: userId });

  if (!customer || customer.tier < 1) {
    const error = new Error("BillXpress Tier 3 KYC is required");
    error.statusCode = 403;
    throw error;
  }

  return customer;
};

const requireOwnedCard = async (userId, cardId) => {
  const normalizedCardId = String(cardId || "").trim();

  if (!normalizedCardId) {
    throw badRequest("Invalid card id");
  }

  const cardMatch = mongoose.Types.ObjectId.isValid(normalizedCardId)
    ? {
        $or: [{ _id: normalizedCardId }, { providerCardId: normalizedCardId }],
      }
    : { providerCardId: normalizedCardId };

  const card = await VirtualDollarCard.findOne({
    user: userId,
    ...cardMatch,
  });

  if (!card) {
    const error = new Error("Card not found");
    error.statusCode = 404;
    throw error;
  }

  return card;
};

const createQuoteExpiry = (setting) =>
  new Date(Date.now() + setting.quoteTtlSeconds * 1000);

const calculateProviderFeeInNgn = (providerFee, providerQuote) => {
  const feeInUsd = calculateTieredFee(
    providerQuote.targetAmount,
    providerFee
  );

  if (feeInUsd === 0 || providerQuote.targetAmount <= 0) {
    return 0;
  }

  return Math.ceil(
    (feeInUsd * providerQuote.sourceAmount) / providerQuote.targetAmount
  );
};

const calculateUsdFeeAtCustomerRate = ({
  feeConfig,
  providerQuote,
  exchangeMarkup,
}) => {
  const feeInUsd = calculateFee(providerQuote.targetAmount, feeConfig);

  if (feeInUsd === 0 || providerQuote.targetAmount <= 0) {
    return { feeInUsd: 0, feeInNgn: 0, customerRate: 0 };
  }

  const customerRate = Number(
    (
      (providerQuote.sourceAmount + exchangeMarkup) /
      providerQuote.targetAmount
    ).toFixed(2)
  );

  return {
    feeInUsd,
    feeInNgn: Math.ceil(feeInUsd * customerRate),
    customerRate,
  };
};

const calculateWithdrawalProviderFeeInNgn = (providerFee, providerQuote) => {
  const feeInUsd = calculateFee(providerQuote.sourceAmount, providerFee);

  if (feeInUsd === 0 || providerQuote.sourceAmount <= 0) {
    return 0;
  }

  return Math.ceil(
    (feeInUsd * providerQuote.targetAmount) / providerQuote.sourceAmount
  );
};

export const getAdminCardRatePreview = async ({
  amountNgn = 10000,
  amountUsd = 10,
} = {}) => {
  const setting = await getOrCreateCardSetting();
  const amountNgnInMinorUnit = toMinorUnit(amountNgn);
  const amountUsdInMinorUnit = toMinorUnit(amountUsd);
  const [fundingQuote, withdrawalQuote] = await Promise.all([
    generateMapleradFxQuote({
      sourceCurrency: "NGN",
      targetCurrency: "USD",
      amountInMinorUnit: amountNgnInMinorUnit,
    }),
    generateMapleradFxQuote({
      sourceCurrency: "USD",
      targetCurrency: "NGN",
      amountInMinorUnit: amountUsdInMinorUnit,
    }),
  ]);

  const fundingMarkup = Math.round(
    (fundingQuote.sourceAmount * setting.fundingExchangeMarkupPercent) / 100
  );
  const withdrawalMarkup = Math.round(
    (withdrawalQuote.targetAmount *
      setting.withdrawalExchangeMarkupPercent) /
      100
  );
  const providerFundingRate =
    fundingQuote.targetAmount > 0
      ? fundingQuote.sourceAmount / fundingQuote.targetAmount
      : 0;
  const customerFundingRate =
    fundingQuote.targetAmount > 0
      ? (fundingQuote.sourceAmount + fundingMarkup) /
        fundingQuote.targetAmount
      : 0;
  const providerWithdrawalRate =
    withdrawalQuote.sourceAmount > 0
      ? withdrawalQuote.targetAmount / withdrawalQuote.sourceAmount
      : 0;
  const customerWithdrawalRate =
    withdrawalQuote.sourceAmount > 0
      ? (withdrawalQuote.targetAmount - withdrawalMarkup) /
        withdrawalQuote.sourceAmount
      : 0;

  return {
    fetchedAt: new Date(),
    settings: {
      fundingExchangeMarkupPercent: setting.fundingExchangeMarkupPercent,
      withdrawalExchangeMarkupPercent:
        setting.withdrawalExchangeMarkupPercent,
    },
    funding: {
      direction: "NGN_TO_USD",
      input: {
        currency: "NGN",
        amount: fromMinorUnit(fundingQuote.sourceAmount),
      },
      outputBeforeCharges: {
        currency: "USD",
        amount: fromMinorUnit(fundingQuote.targetAmount),
      },
      providerRate: {
        ngnPerUsd: Number(providerFundingRate.toFixed(2)),
        display: `1 USD = NGN ${providerFundingRate.toFixed(2)}`,
      },
      configuredMarkup: {
        percent: setting.fundingExchangeMarkupPercent,
        amountNgn: fromMinorUnit(fundingMarkup),
      },
      effectiveCustomerRate: {
        ngnPerUsd: Number(customerFundingRate.toFixed(2)),
        display: `1 USD costs NGN ${customerFundingRate.toFixed(2)}`,
      },
    },
    withdrawal: {
      direction: "USD_TO_NGN",
      input: {
        currency: "USD",
        amount: fromMinorUnit(withdrawalQuote.sourceAmount),
      },
      outputBeforeCharges: {
        currency: "NGN",
        amount: fromMinorUnit(withdrawalQuote.targetAmount),
      },
      providerRate: {
        ngnPerUsd: Number(providerWithdrawalRate.toFixed(2)),
        display: `1 USD = NGN ${providerWithdrawalRate.toFixed(2)}`,
      },
      configuredMarkup: {
        percent: setting.withdrawalExchangeMarkupPercent,
        amountNgn: fromMinorUnit(withdrawalMarkup),
      },
      effectiveCustomerRate: {
        ngnPerUsd: Number(customerWithdrawalRate.toFixed(2)),
        display: `User receives NGN ${customerWithdrawalRate.toFixed(
          2
        )} per USD before other fees`,
      },
    },
  };
};

export const createCardCreationQuote = async ({
  userId,
  amountNgn,
  brand,
}) => {
  const setting = await requireCardService();
  await requireEligibleCustomer(userId);

  const selectedBrand = String(brand || setting.defaultBrand).toUpperCase();
  if (!setting.allowedBrands.includes(selectedBrand)) {
    throw badRequest("Selected card brand is not available");
  }

  const ignoredInitialFundingAmount = Number(amountNgn) || 0;
  const billxpressCreationFeeUsd = calculateFee(0, setting.creationFeeUsd);
  const providerCreationFeeUsd = calculateFee(
    0,
    setting.providerCreationFee
  );
  const totalCreationFeeUsd =
    billxpressCreationFeeUsd + providerCreationFeeUsd;
  const providerQuote =
    totalCreationFeeUsd > 0
      ? await generateMapleradFxQuote({
          sourceCurrency: "USD",
          targetCurrency: "NGN",
          amountInMinorUnit: totalCreationFeeUsd,
        })
      : null;
  const billxpressCreationFee =
    totalCreationFeeUsd > 0
      ? Math.ceil(
          (billxpressCreationFeeUsd *
            providerQuote.targetAmount) /
            totalCreationFeeUsd
        )
      : 0;
  const providerCreationFee =
    totalCreationFeeUsd > 0
      ? providerQuote.targetAmount - billxpressCreationFee
      : 0;
  const billxpressFundingFee = 0;
  const providerFundingFee = 0;
  const billxpressFee = billxpressCreationFee;
  const providerFee = providerCreationFee;
  const fee = billxpressFee + providerFee;
  return CardQuote.create({
    user: userId,
    operation: "creation",
    brand: selectedBrand,
    providerQuoteReference:
      providerQuote?.reference || generateTransactionReference("VDCQ"),
    sourceCurrency: "NGN",
    sourceAmount: fee,
    targetCurrency: "USD",
    targetAmount: 0,
    providerRate: providerQuote?.rate || 0,
    fee,
    exchangeMarkup: 0,
    walletDebit: fee,
    expiresAt: createQuoteExpiry(setting),
    pricingSnapshot: {
      settings: serializeCardSetting(setting),
      initialFundingEnabled: false,
      ignoredInitialFundingAmount: Math.max(0, ignoredInitialFundingAmount),
      providerFee,
      billxpressFee,
      billxpressCreationFee,
      billxpressCreationFeeUsd,
      creationFeeCustomerRate:
        totalCreationFeeUsd > 0
          ? Number((providerQuote.targetAmount / totalCreationFeeUsd).toFixed(2))
          : 0,
      providerCreationFee,
      providerCreationFeeUsd,
      billxpressFundingFee,
      providerFundingFee,
    },
    providerResponse: providerQuote?.providerResponse || {},
  });
};

export const createCardFundingQuote = async ({
  userId,
  cardId,
  amountNgn,
}) => {
  const setting = await requireCardService();
  const card = await requireOwnedCard(userId, cardId);

  if (!["ACTIVE", "FROZEN"].includes(card.status)) {
    throw badRequest("Only an active or frozen card can be funded");
  }

  if (!card.providerCardId) {
    throw badRequest("Card is not active on Maplerad yet");
  }

  const amountInMinorUnit = toMinorUnit(amountNgn);
  if (
    amountInMinorUnit < setting.minimumFundingAmount ||
    amountInMinorUnit > setting.maximumFundingAmount
  ) {
    throw badRequest("Funding amount is outside the configured limits");
  }

  const providerQuote = await generateMapleradFxQuote({
    sourceCurrency: "NGN",
    targetCurrency: "USD",
    amountInMinorUnit,
  });
  const customerFee = calculateTieredFee(amountInMinorUnit, setting.fundingFee);
  const providerFee = 0;
  const fee = customerFee;
  const billxpressFee = customerFee;
  const exchangeMarkup = Math.round(
    (amountInMinorUnit * setting.fundingExchangeMarkupPercent) / 100
  );

  return CardQuote.create({
    user: userId,
    card: card._id,
    operation: "funding",
    providerQuoteReference: providerQuote.reference,
    sourceCurrency: providerQuote.sourceCurrency,
    sourceAmount: providerQuote.sourceAmount,
    targetCurrency: providerQuote.targetCurrency,
    targetAmount: providerQuote.targetAmount,
    providerRate: providerQuote.rate,
    fee,
    exchangeMarkup,
    walletDebit: amountInMinorUnit + fee + exchangeMarkup,
    expiresAt: createQuoteExpiry(setting),
    pricingSnapshot: {
      settings: serializeCardSetting(setting),
      providerFee,
      billxpressFee,
      customerFee,
    },
    providerResponse: providerQuote.providerResponse,
  });
};

export const createCardWithdrawalQuote = async ({
  userId,
  cardId,
  amountUsd,
}) => {
  const setting = await requireCardService();
  const card = await requireOwnedCard(userId, cardId);

  if (card.status !== "ACTIVE") {
    throw badRequest("Only an active card can be withdrawn from");
  }

  if (!card.providerCardId) {
    throw badRequest("Card is not active on Maplerad yet");
  }

  const amountInMinorUnit = toMinorUnit(amountUsd);
  if (amountInMinorUnit < setting.minimumWithdrawalAmount) {
    throw badRequest(
      `Minimum withdrawal is USD ${fromMinorUnit(
        setting.minimumWithdrawalAmount
      )}`
    );
  }

  const providerQuote = await generateMapleradFxQuote({
    sourceCurrency: "USD",
    targetCurrency: "NGN",
    amountInMinorUnit,
  });
  const customerFee = calculateTieredFee(
    providerQuote.targetAmount,
    setting.withdrawalFee
  );
  const providerFee = 0;
  const fee = customerFee;
  const billxpressFee = customerFee;
  const exchangeMarkup = Math.round(
    (providerQuote.targetAmount *
      setting.withdrawalExchangeMarkupPercent) /
      100
  );
  const walletCredit = providerQuote.targetAmount - fee - exchangeMarkup;

  if (walletCredit <= 0) {
    throw badRequest("Withdrawal amount is too small after charges");
  }

  return CardQuote.create({
    user: userId,
    card: card._id,
    operation: "withdrawal",
    providerQuoteReference: providerQuote.reference,
    sourceCurrency: providerQuote.sourceCurrency,
    sourceAmount: providerQuote.sourceAmount,
    targetCurrency: providerQuote.targetCurrency,
    targetAmount: providerQuote.targetAmount,
    providerRate: providerQuote.rate,
    fee,
    exchangeMarkup,
    walletCredit,
    expiresAt: createQuoteExpiry(setting),
    pricingSnapshot: {
      settings: serializeCardSetting(setting),
      providerFee,
      billxpressFee,
    },
    providerResponse: providerQuote.providerResponse,
  });
};

const startQuote = async ({ userId, quoteId, operation }) => {
  const quote = await CardQuote.findOneAndUpdate(
    {
    _id: quoteId,
    user: userId,
    operation,
    status: "pending",
      expiresAt: { $gt: new Date() },
    },
    {
      status: "processing",
    },
    {
      new: true,
    }
  );

  if (!quote) {
    await CardQuote.updateOne(
      {
        _id: quoteId,
        user: userId,
        operation,
        status: "pending",
        expiresAt: { $lte: new Date() },
      },
      { status: "expired" }
    );
    throw badRequest("Quote is invalid, expired, or has already been used");
  }

  return quote;
};

const requireUserPin = async (userId, transactionPin) => {
  const user = await User.findById(userId).select("+transactionPin");
  if (!user || !user.isActive) {
    const error = new Error("User account is not active");
    error.statusCode = 401;
    throw error;
  }
  await verifyTransactionPin(user, transactionPin);
  return user;
};

const refundCardDebit = async ({
  userId,
  quote,
  originalReference,
  reason,
  providerFailureCode,
}) =>
  creditWallet({
    userId,
    amountInMinorUnit: quote.walletDebit,
    walletType: "main",
    type: "reversal",
    reference: `${originalReference}_REV`,
    provider: "maplerad",
    narration: "Refund for failed virtual dollar card operation",
    metadata: {
      service: "virtual_dollar_card",
      quoteId: quote._id,
      originalReference,
      reason,
      providerFailureCode,
    },
  });

const buildCardProviderFailureError = (error, serviceName) => {
  const publicFailure = getPublicProviderFailure(error, serviceName);
  const publicError = new Error(publicFailure.message);
  publicError.statusCode = publicFailure.statusCode;
  publicError.code = publicFailure.code;
  return { publicFailure, publicError };
};

const serializeInternalProviderError = (error) =>
  error.providerResponse || {
    message: error.message,
    statusCode: error.statusCode,
    code: error.code,
  };

const mapProviderCardStatus = (status) => {
  const normalizedStatus = String(status || "ACTIVE").toUpperCase();

  if (normalizedStatus === "DISABLED") {
    return "FROZEN";
  }

  return ["PENDING", "ACTIVE", "FROZEN", "FAILED", "TERMINATED"].includes(
    normalizedStatus
  )
    ? normalizedStatus
    : "ACTIVE";
};

export const createVirtualDollarCard = async ({
  userId,
  quoteId,
  transactionPin,
}) => {
  await requireCardService();
  await requireUserPin(userId, transactionPin);
  const customer = await requireEligibleCustomer(userId);
  const quote = await startQuote({ userId, quoteId, operation: "creation" });
  const reference = generateTransactionReference("VDC");
  let debitResult;

  try {
    if (quote.walletDebit > 0) {
      debitResult = await debitWallet({
        userId,
        amountInMinorUnit: quote.walletDebit,
        walletType: "main",
        type: "debit",
        reference,
        provider: "maplerad",
        narration: "Virtual dollar card creation",
        metadata: {
          service: "virtual_dollar_card",
          operation: "creation",
          quoteId: quote._id,
          usdAmount: quote.targetAmount,
          fee: quote.fee,
          exchangeMarkup: quote.exchangeMarkup,
        },
      });
    }

    const exchangeResponse =
      quote.targetAmount > 0
        ? await exchangeMapleradCurrency(quote.providerQuoteReference)
        : null;
    const creationResult = await createMapleradCard({
      customerId: customer.customerId,
      brand: quote.brand,
      amountInMinorUnit: quote.targetAmount,
    });
    const providerCard = creationResult.providerCard || {};
    const card = await VirtualDollarCard.create({
      user: userId,
      mapleradCustomerId: customer.customerId,
      creationReference: creationResult.reference,
      brand: quote.brand,
      providerCardId: creationResult.providerCardId,
      status: creationResult.providerCardId
        ? mapProviderCardStatus(providerCard.status)
        : "PENDING",
      name: providerCard.name,
      maskedPan: providerCard.masked_pan,
      balance: Number(providerCard.balance) || quote.targetAmount || 0,
      nextMaintenanceAt: creationResult.providerCardId
        ? addOneMonth(new Date())
        : null,
      providerResponse: creationResult.providerResponse,
    });

    quote.card = card._id;
    quote.status = "completed";
    quote.completedAt = new Date();
    quote.providerResponse = {
      quote: quote.providerResponse,
      exchange: exchangeResponse,
      creation: creationResult.providerResponse,
    };
    await quote.save();

    return {
      message: creationResult.providerCardId
        ? "Card created successfully"
        : "Card creation is processing",
      card,
      quote,
      wallet: debitResult?.wallet,
      transaction: debitResult?.transaction,
    };
  } catch (error) {
    const mappedFailure = debitResult
      ? buildCardProviderFailureError(error, "Card creation")
      : null;

    quote.status = "failed";
    quote.failureReason = mappedFailure?.publicFailure.message || error.message;
    quote.providerResponse = {
      quote: quote.providerResponse,
      internalProviderError: serializeInternalProviderError(error),
      publicFailure: mappedFailure?.publicFailure,
    };
    quote.markModified("providerResponse");
    await quote.save();

    if (debitResult) {
      await refundCardDebit({
        userId,
        quote,
        originalReference: reference,
        reason: mappedFailure.publicFailure.message,
        providerFailureCode: mappedFailure.publicFailure.code,
      });
    }
    throw mappedFailure?.publicError || error;
  }
};

export const fundVirtualDollarCard = async ({
  userId,
  cardId,
  quoteId,
  transactionPin,
}) => {
  await requireCardService();
  await requireUserPin(userId, transactionPin);
  const card = await requireOwnedCard(userId, cardId);
  const quote = await startQuote({ userId, quoteId, operation: "funding" });

  if (String(quote.card) !== String(card._id)) {
    quote.status = "failed";
    quote.failureReason = "Quote does not belong to this card";
    await quote.save();
    throw badRequest("Quote does not belong to this card");
  }

  const reference = generateTransactionReference("VCF");
  let debitResult;

  try {
    debitResult = await debitWallet({
      userId,
      amountInMinorUnit: quote.walletDebit,
      walletType: "main",
      type: "debit",
      reference,
      provider: "maplerad",
      narration: "Virtual dollar card funding",
      metadata: {
        service: "virtual_dollar_card",
        operation: "funding",
        cardId: card._id,
        quoteId: quote._id,
        usdAmount: quote.targetAmount,
        fee: quote.fee,
        exchangeMarkup: quote.exchangeMarkup,
      },
    });
    const fundingResponse = await fundMapleradCard(
      card.providerCardId,
      quote.targetAmount
    );

    card.balance += quote.targetAmount;
    await card.save();
    quote.status = "completed";
    quote.completedAt = new Date();
    quote.providerResponse = {
      quote: quote.providerResponse,
      funding: fundingResponse,
      fxQuoteUsedForPricingOnly: true,
    };
    await quote.save();

    return {
      message: "Card funded successfully",
      card,
      quote,
      wallet: debitResult.wallet,
      transaction: debitResult.transaction,
    };
  } catch (error) {
    const mappedFailure = debitResult
      ? buildCardProviderFailureError(error, "Card funding")
      : null;

    quote.status = "failed";
    quote.failureReason = mappedFailure?.publicFailure.message || error.message;
    quote.providerResponse = {
      quote: quote.providerResponse,
      internalProviderError: serializeInternalProviderError(error),
      publicFailure: mappedFailure?.publicFailure,
    };
    quote.markModified("providerResponse");
    await quote.save();
    if (debitResult) {
      await refundCardDebit({
        userId,
        quote,
        originalReference: reference,
        reason: mappedFailure.publicFailure.message,
        providerFailureCode: mappedFailure.publicFailure.code,
      });
    }
    throw mappedFailure?.publicError || error;
  }
};

export const withdrawVirtualDollarCard = async ({
  userId,
  cardId,
  quoteId,
  transactionPin,
}) => {
  await requireCardService();
  await requireUserPin(userId, transactionPin);
  const card = await requireOwnedCard(userId, cardId);
  const quote = await startQuote({ userId, quoteId, operation: "withdrawal" });

  if (String(quote.card) !== String(card._id)) {
    quote.status = "failed";
    quote.failureReason = "Quote does not belong to this card";
    await quote.save();
    throw badRequest("Quote does not belong to this card");
  }

  try {
    const withdrawalResponse = await withdrawMapleradCard(
      card.providerCardId,
      quote.sourceAmount
    );
    quote.providerResponse = {
      quote: quote.providerResponse,
      withdrawal: withdrawalResponse,
      withdrawalCompleted: true,
    };
    await quote.save();
    const exchangeResponse = await exchangeMapleradCurrency(
      quote.providerQuoteReference
    );
    const creditResult = await creditWallet({
      userId,
      amountInMinorUnit: quote.walletCredit,
      walletType: "main",
      type: "credit",
      reference: generateTransactionReference("VCW"),
      provider: "maplerad",
      narration: "Withdrawal from virtual dollar card",
      metadata: {
        service: "virtual_dollar_card",
        operation: "withdrawal",
        cardId: card._id,
        quoteId: quote._id,
        usdAmount: quote.sourceAmount,
        grossNgnAmount: quote.targetAmount,
        fee: quote.fee,
        exchangeMarkup: quote.exchangeMarkup,
      },
    });

    card.balance = Math.max(0, card.balance - quote.sourceAmount);
    await card.save();
    quote.status = "completed";
    quote.completedAt = new Date();
    quote.providerResponse = {
      quote: quote.providerResponse,
      withdrawal: withdrawalResponse,
      exchange: exchangeResponse,
    };
    await quote.save();

    return {
      message: "Card withdrawal completed",
      card,
      quote,
      wallet: creditResult.wallet,
      transaction: creditResult.transaction,
    };
  } catch (error) {
    const withdrawalCompleted =
      quote.providerResponse?.withdrawalCompleted === true;
    quote.status = withdrawalCompleted ? "processing" : "failed";
    quote.failureReason = withdrawalCompleted
      ? `USD withdrawal completed but NGN settlement requires reconciliation: ${error.message}`
      : error.message;
    await quote.save();

    if (withdrawalCompleted) {
      const settlementError = new Error(
        "Card was debited but NGN settlement is still processing"
      );
      settlementError.statusCode = 502;
      throw settlementError;
    }

    throw error;
  }
};

export const listVirtualDollarCards = async (userId) =>
  VirtualDollarCard.find({ user: userId }).sort({ createdAt: -1 });

export const listAdminVirtualDollarCards = async ({
  page = 1,
  limit = 20,
  status,
  userId,
  maintenancePastDue,
} = {}) => {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const query = {};

  if (status) {
    query.status = String(status).trim().toUpperCase();
  }

  if (userId) {
    query.user = userId;
  }

  if (maintenancePastDue !== undefined) {
    query.maintenancePastDue =
      maintenancePastDue === true || maintenancePastDue === "true";
  }

  const [cards, total] = await Promise.all([
    VirtualDollarCard.find(query)
      .populate("user", "firstName lastName username email phone isActive")
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    VirtualDollarCard.countDocuments(query),
  ]);

  return {
    cards: cards.map((card) => ({
      ...serializeCard(card),
      user: card.user,
      providerCardId: card.providerCardId,
      creationReference: card.creationReference,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
};

export const getVirtualDollarCardDetails = async (userId, cardId) => {
  const card = await requireOwnedCard(userId, cardId);

  if (!card.providerCardId) {
    return { card, providerCard: null };
  }

  let response;
  try {
    response = await getMapleradCard(card.providerCardId);
  } catch (error) {
    return {
      card,
      providerCard: null,
      providerError: {
        message: error.message,
        statusCode: error.statusCode,
      },
    };
  }
  const providerCard = response.data || response;
  card.status = mapProviderCardStatus(providerCard.status || card.status);
  card.balance = Number(providerCard.balance) || card.balance;
  card.name = providerCard.name || card.name;
  card.maskedPan = providerCard.masked_pan || card.maskedPan;
  await card.save();

  return { card, providerCard };
};

export const listVirtualDollarCardTransactions = async ({
  userId,
  cardId,
  query,
}) => {
  const card = await requireOwnedCard(userId, cardId);
  if (!card.providerCardId) {
    return { data: [], meta: { page: 1, page_size: 20, total: 0 } };
  }

  return getMapleradCardTransactions(card.providerCardId, {
    page: query.page || 1,
    pageSize: query.pageSize || query.page_size || 20,
    startDate: query.startDate || query.start_date,
    endDate: query.endDate || query.end_date,
  });
};

export const setVirtualDollarCardFrozen = async ({
  userId,
  cardId,
  transactionPin,
  frozen,
}) => {
  await requireUserPin(userId, transactionPin);
  const card = await requireOwnedCard(userId, cardId);

  if (!card.providerCardId) {
    throw badRequest("Card is not active yet");
  }

  if (frozen) {
    await freezeMapleradCard(card.providerCardId);
    card.status = "FROZEN";
  } else {
    if (card.maintenancePastDue) {
      throw badRequest(
        "Outstanding card maintenance fee must be paid before unfreezing"
      );
    }
    await unfreezeMapleradCard(card.providerCardId);
    card.status = "ACTIVE";
  }

  await card.save();
  return card;
};

export const serializeCardOperation = (result) => ({
  message: result.message,
  card: serializeCard(result.card),
  quote: serializeCardQuote(result.quote),
  wallet: result.wallet ? serializeWallet(result.wallet) : undefined,
  transaction: result.transaction
    ? serializeTransaction(result.transaction)
    : undefined,
});

const addOneMonth = (date) => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
};

const getMaintenanceBillingKey = (card) =>
  card.nextMaintenanceAt.toISOString().slice(0, 7);

const getMaintenanceProviderReference = (card) =>
  `card-maintenance:${card._id}:${getMaintenanceBillingKey(card)}`;

const getMaintenanceGraceDeadline = (card, setting) => {
  const deadline = new Date(card.nextMaintenanceAt);
  deadline.setUTCDate(
    deadline.getUTCDate() + setting.maintenanceGracePeriodDays
  );
  return deadline;
};

const getMaintenanceNgnQuote = (setting) =>
  generateMapleradFxQuote({
    sourceCurrency: "USD",
    targetCurrency: "NGN",
    amountInMinorUnit: setting.monthlyMaintenanceFee,
  });

const notifyCardMaintenance = ({
  card,
  title,
  message,
  priority = "normal",
  event,
  amountNgn,
}) =>
  createNotificationBestEffort({
    userId: card.user,
    title,
    message,
    type: "card_maintenance",
    channel: "both",
    priority,
    data: {
      cardId: card._id,
      event,
      dueAt: card.nextMaintenanceAt,
      graceEndsAt: card.maintenanceGraceEndsAt,
      amountNgn,
    },
  });

const markMaintenanceReminderSent = async (card, reminderKey) => {
  card.maintenanceReminderKeys = [
    ...(card.maintenanceReminderKeys || []).filter(
      (key) => key !== reminderKey
    ),
    reminderKey,
  ].slice(-24);
  await card.save();
};

const finalizeCardMaintenancePayment = async ({
  card,
  setting,
  transaction,
  amountNgn,
}) => {
  const restored = card.frozenForMaintenance;

  if (card.frozenForMaintenance && card.providerCardId) {
    await unfreezeMapleradCard(card.providerCardId);
    card.status = "ACTIVE";
  }

  const paidDueAt = card.nextMaintenanceAt;
  card.lastMaintenanceAt = paidDueAt;
  card.nextMaintenanceAt = addOneMonth(paidDueAt);
  card.maintenancePastDue = false;
  card.maintenanceGraceEndsAt = null;
  card.frozenForMaintenance = false;
  card.lastMaintenanceFailure = null;
  await card.save();

  await notifyCardMaintenance({
    card,
    title: "Card maintenance fee paid",
    message: `Your monthly card maintenance fee of USD ${fromMinorUnit(
      setting.monthlyMaintenanceFee
    )} (NGN ${amountNgn}) was paid successfully. Your next payment is due on ${card.nextMaintenanceAt.toLocaleDateString(
      "en-NG",
      { timeZone: "UTC" }
    )}.`,
    event: "payment_successful",
    amountNgn,
  });

  return { card, transaction, restored };
};

const chargeDueCardMaintenance = async ({ cardId }) => {
  const setting = await getOrCreateCardSetting();
  const now = new Date();
  let card = await VirtualDollarCard.findOneAndUpdate(
    {
      _id: cardId,
      status: { $in: ["ACTIVE", "FROZEN"] },
      nextMaintenanceAt: { $ne: null, $lte: now },
      maintenancePaymentProcessing: { $ne: true },
    },
    { $set: { maintenancePaymentProcessing: true } },
    { returnDocument: "after" }
  );

  if (!card) {
    throw badRequest("Card maintenance fee is not currently due");
  }

  try {
    const providerReference = getMaintenanceProviderReference(card);
    const existing = await Transaction.findOne({ providerReference });

    if (existing && existing.status === "successful") {
      return finalizeCardMaintenancePayment({
        card,
        setting,
        transaction: existing,
        amountNgn: fromMinorUnit(existing.amount),
      });
    }

    const quote = await getMaintenanceNgnQuote(setting);
    const debitResult = await debitWallet({
      userId: card.user,
      amountInMinorUnit: quote.targetAmount,
      walletType: "main",
      type: "debit",
      reference: generateTransactionReference("VCM"),
      provider: "maplerad",
      providerReference,
      narration: "Monthly virtual dollar card maintenance fee",
      metadata: {
        service: "virtual_dollar_card",
        operation: "maintenance",
        cardId: card._id,
        maintenanceFeeUsd: setting.monthlyMaintenanceFee,
        providerRate: quote.rate,
        dueAt: card.nextMaintenanceAt,
      },
    });

    return finalizeCardMaintenancePayment({
      card,
      setting,
      transaction: debitResult.transaction,
      amountNgn: fromMinorUnit(quote.targetAmount),
    });
  } finally {
    await VirtualDollarCard.updateOne(
      { _id: card._id },
      { $set: { maintenancePaymentProcessing: false } }
    );
  }
};

export const payVirtualDollarCardMaintenance = async ({
  userId,
  cardId,
  transactionPin,
}) => {
  await requireUserPin(userId, transactionPin);
  const card = await requireOwnedCard(userId, cardId);
  const result = await chargeDueCardMaintenance({ cardId: card._id });
  const wallet = await getOrCreateWallet(userId);

  return {
    message: result.restored
      ? "Card maintenance fee paid and card restored"
      : "Card maintenance fee paid",
    card: result.card,
    wallet,
    transaction: result.transaction,
  };
};

const processUpcomingMaintenanceReminders = async (setting, now) => {
  const reminderWindowEnd = new Date(now);
  reminderWindowEnd.setUTCDate(reminderWindowEnd.getUTCDate() + 7);
  const cards = await VirtualDollarCard.find({
    status: { $in: ["ACTIVE", "FROZEN"] },
    nextMaintenanceAt: { $gt: now, $lte: reminderWindowEnd },
  }).limit(100);
  let reminded = 0;
  let estimatedAmountNgn = null;

  for (const card of cards) {
    const millisecondsRemaining = card.nextMaintenanceAt.getTime() - now.getTime();
    const daysRemaining = Math.ceil(millisecondsRemaining / (24 * 60 * 60 * 1000));
    const reminderDay =
      daysRemaining <= 1 ? 1 : daysRemaining <= 3 ? 3 : 7;
    const reminderKey = `${getMaintenanceBillingKey(card)}:${reminderDay}`;

    if ((card.maintenanceReminderKeys || []).includes(reminderKey)) {
      continue;
    }

    if (estimatedAmountNgn === null) {
      try {
        const quote = await getMaintenanceNgnQuote(setting);
        estimatedAmountNgn = fromMinorUnit(quote.targetAmount);
      } catch {
        estimatedAmountNgn = undefined;
      }
    }

    await notifyCardMaintenance({
      card,
      title: "Upcoming card maintenance fee",
      message: `Your USD ${fromMinorUnit(
        setting.monthlyMaintenanceFee
      )} card maintenance fee is due in ${daysRemaining} day${
        daysRemaining === 1 ? "" : "s"
      }${
        estimatedAmountNgn
          ? ` (currently about NGN ${estimatedAmountNgn})`
          : ""
      }. Please keep enough money in your BillXpress wallet.`,
      event: `reminder_${reminderDay}_days`,
      amountNgn: estimatedAmountNgn,
    });
    await markMaintenanceReminderSent(card, reminderKey);
    reminded += 1;
  }

  return reminded;
};

export const processDueCardMaintenanceFees = async () => {
  const setting = await getOrCreateCardSetting();

  if (!setting.isEnabled || setting.monthlyMaintenanceFee <= 0) {
    return { processed: 0, reminded: 0, frozen: 0 };
  }

  const now = new Date();
  const reminded = await processUpcomingMaintenanceReminders(setting, now);
  const cards = await VirtualDollarCard.find({
    status: { $in: ["ACTIVE", "FROZEN"] },
    nextMaintenanceAt: { $ne: null, $lte: now },
  }).limit(100);
  let processed = 0;
  let frozen = 0;

  for (const card of cards) {
    try {
      await chargeDueCardMaintenance({ cardId: card._id });
      processed += 1;
    } catch (error) {
      const freshCard = await VirtualDollarCard.findById(card._id);
      const graceDeadline = getMaintenanceGraceDeadline(freshCard, setting);
      const dueKey = `${getMaintenanceBillingKey(freshCard)}:due`;
      const dueNotificationAlreadySent = (
        freshCard.maintenanceReminderKeys || []
      ).includes(dueKey);
      freshCard.maintenancePastDue = true;
      freshCard.maintenanceGraceEndsAt = graceDeadline;
      freshCard.lastMaintenanceFailure = error.message;
      await freshCard.save();

      if (!dueNotificationAlreadySent) {
        await notifyCardMaintenance({
          card: freshCard,
          title: "Card maintenance payment due",
          message: `We could not collect your card maintenance fee. Fund your BillXpress wallet and pay before ${graceDeadline.toLocaleDateString(
            "en-NG",
            { timeZone: "UTC" }
          )} to avoid your card being frozen.`,
          priority: "high",
          event: "payment_due",
        });
        await markMaintenanceReminderSent(freshCard, dueKey);
      }

      if (dueNotificationAlreadySent && now < graceDeadline) {
        const graceDaysRemaining = Math.max(
          1,
          Math.ceil(
            (graceDeadline.getTime() - now.getTime()) /
              (24 * 60 * 60 * 1000)
          )
        );
        const graceKey = `${getMaintenanceBillingKey(
          freshCard
        )}:grace:${graceDaysRemaining}`;

        if (
          !(freshCard.maintenanceReminderKeys || []).includes(graceKey)
        ) {
          await notifyCardMaintenance({
            card: freshCard,
            title: "Card maintenance grace period",
            message: `Your card maintenance fee is still unpaid. You have ${graceDaysRemaining} day${
              graceDaysRemaining === 1 ? "" : "s"
            } left to pay before your card is frozen.`,
            priority: "high",
            event: "grace_period_reminder",
          });
          await markMaintenanceReminderSent(freshCard, graceKey);
        }
      }

      if (
        setting.freezeOnMaintenanceFailure &&
        now >= graceDeadline &&
        freshCard.providerCardId &&
        freshCard.status === "ACTIVE"
      ) {
        try {
          await freezeMapleradCard(freshCard.providerCardId);
          freshCard.status = "FROZEN";
          freshCard.frozenForMaintenance = true;
          await freshCard.save();
          frozen += 1;

          const frozenKey = `${getMaintenanceBillingKey(
            freshCard
          )}:maintenance_frozen`;
          if (
            !(freshCard.maintenanceReminderKeys || []).includes(frozenKey)
          ) {
            await notifyCardMaintenance({
              card: freshCard,
              title: "Card frozen for unpaid maintenance",
              message:
                "Your virtual dollar card has been frozen because its maintenance fee is unpaid. Fund your wallet and use Pay maintenance fee to restore it.",
              priority: "high",
              event: "card_frozen",
            });
            await markMaintenanceReminderSent(freshCard, frozenKey);
          }
        } catch (freezeError) {
          freshCard.lastMaintenanceFailure = freezeError.message;
          await freshCard.save();
          // The next scheduled run will retry the provider freeze.
        }
      }
    }
  }

  return { processed, reminded, frozen };
};
