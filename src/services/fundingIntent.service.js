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
import {
  calculateFundingFee,
  serializeFundingFee,
} from "./fundingFee.service.js";
import { createNotificationBestEffort } from "./notification.service.js";
import { processFirstDepositReferralRewardBestEffort } from "./referral.service.js";

const getFundingExpiryDate = () => {
  const minutes = Number(process.env.MONNIFY_FUNDING_EXPIRES_MINUTES || 15);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 15;

  return new Date(Date.now() + safeMinutes * 60 * 1000);
};

export const serializeFundingIntent = (intent) => ({
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
  feePolicy: serializeFundingFee(intent.provider),
  expiresAt: intent.expiresAt,
  status: intent.status,
  createdAt: intent.createdAt,
});

export const createMonnifyFundingIntent = async (user, amount) => {
  const amountInMinorUnit = toMinorUnit(amount);
  const minimumAmount = toMinorUnit(process.env.MONNIFY_MIN_FUNDING_AMOUNT || 100);

  if (amountInMinorUnit < minimumAmount) {
    const error = new Error(
      `Minimum funding amount is ${process.env.MONNIFY_MIN_FUNDING_AMOUNT || 100}`
    );
    error.statusCode = 400;
    throw error;
  }

  const feeResult = calculateFundingFee(amountInMinorUnit, "monnify");
  const { fee, amountToReceive } = feeResult;

  if (amountToReceive <= 0) {
    const error = new Error("Funding amount must be greater than the fee");
    error.statusCode = 400;
    throw error;
  }

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

  const creditResult = await creditWallet({
    userId: intent.user,
    amountInMinorUnit: intent.amountToReceive,
    walletType: "main",
    type: "funding",
    reference: generateTransactionReference("MNF"),
    provider: "monnify",
    providerReference: intent.providerReference,
    narration: "Wallet funding via Monnify one-time transfer",
    metadata: {
      providerTransaction,
      fee: intent.fee,
      grossAmount: intent.amount,
      amountCredited: intent.amountToReceive,
      feePaidBy: "user",
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
      intent.amountToReceive
    )}.`,
    type: "wallet_funding_success",
    channel: "both",
    priority: "normal",
    data: {
      provider: "monnify",
      amount: fromMinorUnit(intent.amountToReceive),
      grossAmount: fromMinorUnit(intent.amount),
      fee: fromMinorUnit(intent.fee),
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
