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
  serializeTransaction,
  serializeWallet,
  toMinorUnit,
  verifyTransactionPin,
} from "./wallet.service.js";

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

const serializeFee = (fee = {}) => ({
  percent: Number(fee.percent) || 0,
  flat: fromMinorUnit(Number(fee.flat) || 0),
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
  creationFee: serializeFee(setting.creationFee),
  providerCreationFee: serializeFee(setting.providerCreationFee),
  fundingFee: serializeFee(setting.fundingFee),
  providerFundingFee: serializeFee(setting.providerFundingFee),
  withdrawalFee: serializeFee(setting.withdrawalFee),
  providerWithdrawalFee: serializeFee(setting.providerWithdrawalFee),
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

  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw badRequest(`${field} percent must be between 0 and 100`);
  }

  if (!Number.isFinite(flat) || flat < 0) {
    throw badRequest(`${field} flat amount must be zero or greater`);
  }

  setting[field] = {
    percent,
    flat: Math.round(flat * 100),
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
  updateFee(setting, "providerCreationFee", payload.providerCreationFee);
  updateFee(setting, "fundingFee", payload.fundingFee);
  updateFee(setting, "providerFundingFee", payload.providerFundingFee);
  updateFee(setting, "withdrawalFee", payload.withdrawalFee);
  updateFee(setting, "providerWithdrawalFee", payload.providerWithdrawalFee);
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
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
});

export const serializeCardQuote = (quote) => ({
  id: quote._id,
  operation: quote.operation,
  brand: quote.brand,
  source: {
    currency: quote.sourceCurrency,
    amount: fromMinorUnit(quote.sourceAmount),
  },
  target: {
    currency: quote.targetCurrency,
    amount: fromMinorUnit(quote.targetAmount),
  },
  providerRate: quote.providerRate,
  fee: fromMinorUnit(quote.fee),
  feeBreakdown: {
    providerFee: fromMinorUnit(
      Number(quote.pricingSnapshot?.providerFee) || 0
    ),
    billxpressFee: fromMinorUnit(
      Number(quote.pricingSnapshot?.billxpressFee) || 0
    ),
  },
  exchangeMarkup: fromMinorUnit(quote.exchangeMarkup),
  walletDebit:
    quote.walletDebit > 0 ? fromMinorUnit(quote.walletDebit) : undefined,
  walletCredit:
    quote.walletCredit > 0 ? fromMinorUnit(quote.walletCredit) : undefined,
  status: quote.status,
  expiresAt: quote.expiresAt,
});

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
  const card = await VirtualDollarCard.findOne({
    _id: cardId,
    user: userId,
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
  const feeInUsd = calculateFee(providerQuote.targetAmount, providerFee);

  if (feeInUsd === 0 || providerQuote.targetAmount <= 0) {
    return 0;
  }

  return Math.ceil(
    (feeInUsd * providerQuote.sourceAmount) / providerQuote.targetAmount
  );
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

export const createCardCreationQuote = async ({
  userId,
  amountNgn,
  brand,
}) => {
  const setting = await requireCardService();
  await requireEligibleCustomer(userId);

  const existingCard = await VirtualDollarCard.findOne({
    user: userId,
    status: { $in: ["PENDING", "ACTIVE", "FROZEN"] },
  });

  if (existingCard) {
    throw badRequest("You already have an active or pending dollar card");
  }

  const selectedBrand = String(brand || setting.defaultBrand).toUpperCase();
  if (!setting.allowedBrands.includes(selectedBrand)) {
    throw badRequest("Selected card brand is not available");
  }

  const amountInMinorUnit = toMinorUnit(amountNgn);
  if (
    amountInMinorUnit < setting.minimumFundingAmount ||
    amountInMinorUnit > setting.maximumFundingAmount
  ) {
    throw badRequest(
      `Amount must be between NGN ${fromMinorUnit(
        setting.minimumFundingAmount
      )} and NGN ${fromMinorUnit(setting.maximumFundingAmount)}`
    );
  }

  const providerQuote = await generateMapleradFxQuote({
    sourceCurrency: "NGN",
    targetCurrency: "USD",
    amountInMinorUnit,
  });
  const billxpressFee =
    calculateFee(amountInMinorUnit, setting.creationFee) +
    calculateFee(amountInMinorUnit, setting.fundingFee);
  const providerFee =
    calculateProviderFeeInNgn(setting.providerCreationFee, providerQuote) +
    calculateProviderFeeInNgn(setting.providerFundingFee, providerQuote);
  const fee = billxpressFee + providerFee;
  const exchangeMarkup = Math.round(
    (amountInMinorUnit * setting.fundingExchangeMarkupPercent) / 100
  );

  return CardQuote.create({
    user: userId,
    operation: "creation",
    brand: selectedBrand,
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
    },
    providerResponse: providerQuote.providerResponse,
  });
};

export const createCardFundingQuote = async ({
  userId,
  cardId,
  amountNgn,
}) => {
  const setting = await requireCardService();
  const card = await requireOwnedCard(userId, cardId);

  if (card.status !== "ACTIVE") {
    throw badRequest("Only an active card can be funded");
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
  const billxpressFee = calculateFee(amountInMinorUnit, setting.fundingFee);
  const providerFee = calculateProviderFeeInNgn(
    setting.providerFundingFee,
    providerQuote
  );
  const fee = billxpressFee + providerFee;
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
  const billxpressFee = calculateFee(
    providerQuote.targetAmount,
    setting.withdrawalFee
  );
  const providerFee = calculateWithdrawalProviderFeeInNgn(
    setting.providerWithdrawalFee,
    providerQuote
  );
  const fee = billxpressFee + providerFee;
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

const refundCardDebit = async ({ userId, quote, originalReference, reason }) =>
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
    },
  });

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
    debitResult = await debitWallet({
      userId,
      amountInMinorUnit: quote.walletDebit,
      walletType: "main",
      type: "debit",
      reference,
      provider: "maplerad",
      narration: "Virtual dollar card creation and initial funding",
      metadata: {
        service: "virtual_dollar_card",
        operation: "creation",
        quoteId: quote._id,
        usdAmount: quote.targetAmount,
        fee: quote.fee,
        exchangeMarkup: quote.exchangeMarkup,
      },
    });

    const exchangeResponse = await exchangeMapleradCurrency(
      quote.providerQuoteReference
    );
    const creationResult = await createMapleradCard({
      customerId: customer.customerId,
      brand: quote.brand,
      amountInMinorUnit: quote.targetAmount,
    });
    const card = await VirtualDollarCard.create({
      user: userId,
      mapleradCustomerId: customer.customerId,
      creationReference: creationResult.reference,
      brand: quote.brand,
      status: "PENDING",
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
      message: "Card creation is processing",
      card,
      quote,
      wallet: debitResult.wallet,
      transaction: debitResult.transaction,
    };
  } catch (error) {
    quote.status = "failed";
    quote.failureReason = error.message;
    await quote.save();

    if (debitResult) {
      await refundCardDebit({
        userId,
        quote,
        originalReference: reference,
        reason: error.message,
      });
    }
    throw error;
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
    const exchangeResponse = await exchangeMapleradCurrency(
      quote.providerQuoteReference
    );
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
      exchange: exchangeResponse,
      funding: fundingResponse,
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
    quote.status = "failed";
    quote.failureReason = error.message;
    await quote.save();
    if (debitResult) {
      await refundCardDebit({
        userId,
        quote,
        originalReference: reference,
        reason: error.message,
      });
    }
    throw error;
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

export const getVirtualDollarCardDetails = async (userId, cardId) => {
  const card = await requireOwnedCard(userId, cardId);

  if (!card.providerCardId) {
    return { card, providerCard: null };
  }

  const response = await getMapleradCard(card.providerCardId);
  const providerCard = response.data || response;
  card.status =
    String(providerCard.status || card.status).toUpperCase() === "DISABLED"
      ? "FROZEN"
      : String(providerCard.status || card.status).toUpperCase();
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
  wallet: serializeWallet(result.wallet),
  transaction: serializeTransaction(result.transaction),
});

const addOneMonth = (date) => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
};

export const processDueCardMaintenanceFees = async () => {
  const setting = await getOrCreateCardSetting();

  if (!setting.isEnabled || setting.monthlyMaintenanceFee <= 0) {
    return { processed: 0 };
  }

  const now = new Date();
  const cards = await VirtualDollarCard.find({
    status: { $in: ["ACTIVE", "FROZEN"] },
    nextMaintenanceAt: { $ne: null, $lte: now },
  }).limit(100);
  let processed = 0;

  for (const card of cards) {
    const billingKey = card.nextMaintenanceAt.toISOString().slice(0, 7);
    const providerReference = `card-maintenance:${card._id}:${billingKey}`;
    const existing = await Transaction.findOne({ providerReference });

    if (existing) {
      card.lastMaintenanceAt = card.nextMaintenanceAt;
      card.nextMaintenanceAt = addOneMonth(card.nextMaintenanceAt);
      card.maintenancePastDue = false;
      await card.save();
      continue;
    }

    try {
      const quote = await generateMapleradFxQuote({
        sourceCurrency: "USD",
        targetCurrency: "NGN",
        amountInMinorUnit: setting.monthlyMaintenanceFee,
      });
      await debitWallet({
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
        },
      });
      card.lastMaintenanceAt = card.nextMaintenanceAt;
      card.nextMaintenanceAt = addOneMonth(card.nextMaintenanceAt);
      card.maintenancePastDue = false;
      await card.save();
      processed += 1;
    } catch (error) {
      const graceDeadline = new Date(card.nextMaintenanceAt);
      graceDeadline.setUTCDate(
        graceDeadline.getUTCDate() + setting.maintenanceGracePeriodDays
      );

      if (
        setting.freezeOnMaintenanceFailure &&
        now >= graceDeadline &&
        card.providerCardId
      ) {
        card.maintenancePastDue = true;
        try {
          if (card.status === "ACTIVE") {
            await freezeMapleradCard(card.providerCardId);
          }
          card.status = "FROZEN";
          await card.save();
        } catch {
          await card.save();
          // The next scheduled run will retry the provider freeze.
        }
      }
    }
  }

  return { processed };
};
