import FundingIntent from "../models/fundingIntent.model.js";
import {
  fromMinorUnit,
  generateTransactionReference,
  toMinorUnit,
} from "./wallet.service.js";
import { createMonnifyTransferIntent } from "./monnify.service.js";
import {
  calculateFundingFee,
  serializeFundingFee,
} from "./fundingFee.service.js";

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
