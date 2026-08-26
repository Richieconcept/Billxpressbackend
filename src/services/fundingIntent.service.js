import FundingIntent from "../models/fundingIntent.model.js";
import Transaction from "../models/transaction.model.js";
import {
  creditWallet,
  fromMinorUnit,
  generateTransactionReference,
  getOrCreateWallet,
  toMinorUnit,
} from "./wallet.service.js";
import {
  createMonnifyTransferIntent,
  getMonnifyTransactionStatus,
} from "./monnify.service.js";
import { createMapleradDynamicAccount } from "./maplerad.service.js";
import { createFlutterwaveDynamicAccount } from "./flutterwave.service.js";
import {
  calculateFundingFee,
  getOneTimeFundingProvider,
  serializeFundingFee,
} from "./fundingFee.service.js";
import { createNotificationBestEffort } from "./notification.service.js";
import { processFirstDepositReferralRewardBestEffort } from "./referral.service.js";

const getFundingExpiryDate = () => {
  const minutes = Number(process.env.ONE_TIME_FUNDING_EXPIRES_MINUTES || 15);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 15;

  return new Date(Date.now() + safeMinutes * 60 * 1000);
};

const getMinimumFundingAmount = (provider) => {
  const prefix = provider.toUpperCase();
  const amount = Number(
    process.env[`${prefix}_MIN_FUNDING_AMOUNT`] ||
      process.env.ONE_TIME_MIN_FUNDING_AMOUNT ||
      100
  );

  return Number.isFinite(amount) && amount > 0 ? amount : 100;
};

export const serializeFundingIntent = async (intent) => ({
  id: intent._id,
  provider: intent.provider,
  providerReference: intent.providerReference,
  paymentReference: intent.paymentReference,
  accountNumber: intent.accountNumber,
  accountName: intent.accountName,
  bankName: intent.bankName,
  amount: fromMinorUnit(intent.amount),
  fee: fromMinorUnit(intent.fee),
  amountToReceive: fromMinorUnit(intent.amountToReceive),
  feePolicy: await serializeFundingFee(intent.provider),
  expiresAt: intent.expiresAt,
  status: intent.status,
  createdAt: intent.createdAt,
});

export const createMonnifyFundingIntent = async (user, amount) => {
  const amountInMinorUnit = toMinorUnit(amount);
  const minimumFundingAmount = getMinimumFundingAmount("monnify");
  const minimumAmount = toMinorUnit(minimumFundingAmount);

  if (amountInMinorUnit < minimumAmount) {
    const error = new Error(`Minimum funding amount is ${minimumFundingAmount}`);
    error.statusCode = 400;
    throw error;
  }

  const feeResult = await calculateFundingFee(amountInMinorUnit, "monnify");
  const { fee, amountToReceive } = feeResult;

  const paymentReference = generateTransactionReference("MNFUND");
  const providerIntent = await createMonnifyTransferIntent({
    amount: fromMinorUnit(amountInMinorUnit),
    customerName: `${user.firstName} ${user.lastName}`.trim() || user.username,
    customerEmail: user.email,
    paymentReference,
  });

  const intent = await FundingIntent.create({
    user: user._id,
    provider: "monnify",
    providerReference: providerIntent.transactionReference,
    paymentReference,
    amount: amountInMinorUnit,
    fee,
    amountToReceive,
    accountNumber: providerIntent.accountNumber,
    accountName: providerIntent.accountName,
    bankName: providerIntent.bankName,
    bankCode: providerIntent.bankCode,
    expiresAt: getFundingExpiryDate(),
    providerResponse: providerIntent.providerResponse,
  });

  return intent;
};

export const createMapleradFundingIntent = async (user, amount) => {
  const amountInMinorUnit = toMinorUnit(amount);
  const minimumFundingAmount = getMinimumFundingAmount("maplerad");
  const minimumAmount = toMinorUnit(minimumFundingAmount);

  if (amountInMinorUnit < minimumAmount) {
    const error = new Error(`Minimum funding amount is ${minimumFundingAmount}`);
    error.statusCode = 400;
    throw error;
  }

  const feeResult = await calculateFundingFee(amountInMinorUnit, "maplerad");
  const { fee, amountToReceive } = feeResult;
  const paymentReference = generateTransactionReference("MLFUND");
  const providerIntent = await createMapleradDynamicAccount({
    amountInMinorUnit,
    accountName: `${user.firstName} ${user.lastName}`.trim() || user.username,
  });

  const intent = await FundingIntent.create({
    user: user._id,
    provider: "maplerad",
    providerReference: providerIntent.providerReference,
    paymentReference,
    amount: amountInMinorUnit,
    fee,
    amountToReceive,
    accountNumber: providerIntent.accountNumber,
    accountName: providerIntent.accountName,
    bankName: providerIntent.bankName,
    bankCode: providerIntent.bankCode,
    expiresAt: getFundingExpiryDate(),
    providerResponse: {
      ...providerIntent.providerResponse,
      localPaymentReference: paymentReference,
    },
  });

  return intent;
};

export const createFlutterwaveFundingIntent = async (user, amount) => {
  const amountInMinorUnit = toMinorUnit(amount);
  const minimumFundingAmount = getMinimumFundingAmount("flutterwave");
  const minimumAmount = toMinorUnit(minimumFundingAmount);

  if (amountInMinorUnit < minimumAmount) {
    const error = new Error(`Minimum funding amount is ${minimumFundingAmount}`);
    error.statusCode = 400;
    throw error;
  }

  const paymentReference = generateTransactionReference("FLWFUND");
  const providerIntent = await createFlutterwaveDynamicAccount({
    amount: fromMinorUnit(amountInMinorUnit),
    customerName: `${user.firstName} ${user.lastName}`.trim() || user.username,
    customerEmail: user.email,
    paymentReference,
  });
  const providerAmountInMinorUnit = toMinorUnit(providerIntent.amount);
  const expectedAmountInMinorUnit =
    providerAmountInMinorUnit > 0 ? providerAmountInMinorUnit : amountInMinorUnit;
  const expectedFeeResult = await calculateFundingFee(
    expectedAmountInMinorUnit,
    "flutterwave"
  );

  const intent = await FundingIntent.create({
    user: user._id,
    provider: "flutterwave",
    providerReference: providerIntent.providerReference,
    paymentReference,
    amount: expectedAmountInMinorUnit,
    fee: expectedFeeResult.fee,
    amountToReceive: expectedFeeResult.amountToReceive,
    accountNumber: providerIntent.accountNumber,
    accountName: providerIntent.accountName,
    bankName: providerIntent.bankName,
    bankCode: providerIntent.bankCode,
    expiresAt: providerIntent.expiresAt || getFundingExpiryDate(),
    providerResponse: {
      ...providerIntent.providerResponse,
      requestedAmount: fromMinorUnit(amountInMinorUnit),
      providerExpectedAmount: fromMinorUnit(expectedAmountInMinorUnit),
    },
  });

  return intent;
};

export const createOneTimeFundingIntent = async (user, amount) => {
  const provider = await getOneTimeFundingProvider();

  if (provider === "monnify") {
    return createMonnifyFundingIntent(user, amount);
  }

  if (provider === "flutterwave") {
    return createFlutterwaveFundingIntent(user, amount);
  }

  return createMapleradFundingIntent(user, amount);
};

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const toMinorUnitOrZero = (amount) => {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return 0;
  }

  return Math.round(numericAmount * 100);
};

const normalizeMonnifyStatus = (providerStatus) => {
  const status = String(providerStatus || "").toUpperCase();

  if (["PAID", "SUCCESS", "SUCCESSFUL", "OVERPAID"].includes(status)) {
    return "paid";
  }

  if (["FAILED", "CANCELLED", "CANCELED", "EXPIRED"].includes(status)) {
    return status === "EXPIRED" ? "expired" : "failed";
  }

  return "pending";
};

export const confirmMonnifyFundingIntent = async (user, fundingIntentId) => {
  if (!fundingIntentId) {
    const error = new Error("Funding intent ID is required");
    error.statusCode = 400;
    throw error;
  }

  const intent = await FundingIntent.findOne({
    _id: fundingIntentId,
    user: user._id,
    provider: "monnify",
  });

  if (!intent) {
    const error = new Error("Funding account not found");
    error.statusCode = 404;
    throw error;
  }

  const existingTransaction = await Transaction.findOne({
    provider: "monnify",
    providerReference: intent.providerReference,
  });

  if (existingTransaction || intent.status === "paid") {
    const wallet = await getOrCreateWallet(intent.user);

    return {
      status: "paid",
      intent,
      wallet,
      transaction: existingTransaction,
      alreadyProcessed: true,
    };
  }

  if (intent.expiresAt < new Date()) {
    intent.status = "expired";
    await intent.save();

    return {
      status: "expired",
      intent,
      providerTransaction: null,
    };
  }

  const providerTransaction = await getMonnifyTransactionStatus(
    intent.providerReference
  );
  const providerStatus = pickFirst(
    providerTransaction.paymentStatus,
    providerTransaction.status,
    providerTransaction.transactionStatus
  );
  const status = normalizeMonnifyStatus(providerStatus);

  if (status !== "paid") {
    if (status === "failed" || status === "expired") {
      intent.status = status;
      intent.providerResponse = {
        ...intent.providerResponse,
        statusCheck: providerTransaction,
      };
      await intent.save();
    }

    return {
      status,
      intent,
      providerTransaction,
    };
  }

  const amountPaid = pickFirst(
    providerTransaction.amountPaid,
    providerTransaction.paidAmount,
    providerTransaction.amount
  );
  const amountPaidInMinorUnit = toMinorUnitOrZero(amountPaid);

  if (amountPaidInMinorUnit < intent.amount) {
    const error = new Error("Payment amount is less than expected funding amount");
    error.statusCode = 400;
    throw error;
  }

  const amountToCredit = amountPaidInMinorUnit || intent.amount;
  const feeResult = await calculateFundingFee(amountToCredit, "monnify");
  intent.fee = feeResult.fee;
  intent.amountToReceive = feeResult.amountToReceive;

  const creditResult = await creditWallet({
    userId: intent.user,
    amountInMinorUnit: feeResult.amountToReceive,
    walletType: "main",
    type: "funding",
    reference: generateTransactionReference("MNF"),
    provider: "monnify",
    providerReference: intent.providerReference,
    narration: "Wallet funding via Monnify one-time transfer",
    metadata: {
      providerTransaction,
      fee: feeResult.fee,
      grossAmount: intent.amount,
      amountPaid: amountPaidInMinorUnit,
      amountCredited: feeResult.amountToReceive,
      feePaidBy: feeResult.creditPolicy === "net" ? "user" : "platform",
      confirmedBy: "user_status_check",
    },
  });

  intent.status = "paid";
  intent.paidAt = new Date();
  intent.providerResponse = {
    ...intent.providerResponse,
    statusCheck: providerTransaction,
  };
  await intent.save();

  await createNotificationBestEffort({
    userId: intent.user,
    title: "Wallet funded successfully",
    message: `Your wallet has been credited with NGN ${fromMinorUnit(
      feeResult.amountToReceive
    )}.`,
    type: "wallet_funding_success",
    channel: "both",
    priority: "normal",
    data: {
      provider: "monnify",
      amount: fromMinorUnit(feeResult.amountToReceive),
      grossAmount: fromMinorUnit(intent.amount),
      fee: fromMinorUnit(intent.fee),
      userReceivesFullAmount: feeResult.creditPolicy !== "net",
      reference: creditResult.transaction.reference,
      providerReference: intent.providerReference,
      paymentReference: intent.paymentReference,
      confirmedBy: "user_status_check",
    },
  });

  await processFirstDepositReferralRewardBestEffort({
    referredUserId: intent.user,
    qualifyingAmountInMinorUnit: intent.amount,
    fundingTransaction: creditResult.transaction,
    provider: "monnify",
    providerReference: intent.providerReference,
  });

  return {
    status: "paid",
    intent,
    wallet: creditResult.wallet,
    transaction: creditResult.transaction,
    alreadyProcessed: false,
  };
};

export const confirmFundingIntentStatus = async (user, fundingIntentId) => {
  const intent = await FundingIntent.findOne({
    _id: fundingIntentId,
    user: user._id,
  });

  if (!intent) {
    const error = new Error("Funding account not found");
    error.statusCode = 404;
    throw error;
  }

  if (intent.provider === "monnify") {
    return confirmMonnifyFundingIntent(user, fundingIntentId);
  }

  if (intent.status === "paid") {
    const existingTransaction = await Transaction.findOne({
      provider: intent.provider,
      providerReference: intent.providerReference,
    });
    const wallet = await getOrCreateWallet(intent.user);

    return {
      status: "paid",
      intent,
      wallet,
      transaction: existingTransaction,
      alreadyProcessed: true,
    };
  }

  if (intent.expiresAt < new Date()) {
    intent.status = "expired";
    await intent.save();

    return {
      status: "expired",
      intent,
      providerTransaction: null,
    };
  }

  return {
    status: intent.status,
    intent,
    providerTransaction: null,
  };
};
