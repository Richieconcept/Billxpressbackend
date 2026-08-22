import bcrypt from "bcryptjs";
import Transaction from "../models/transaction.model.js";
import Wallet from "../models/wallet.model.js";

const MINOR_UNITS = 100;

export const toMinorUnit = (amount) => {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  return Math.round(numericAmount * MINOR_UNITS);
};

export const fromMinorUnit = (amount) => Number((amount / MINOR_UNITS).toFixed(2));

export const serializeWallet = (wallet) => ({
  id: wallet._id,
  user: wallet.user,
  currency: wallet.currency,
  mainBalance: fromMinorUnit(wallet.mainBalance),
  referralBalance: fromMinorUnit(wallet.referralBalance),
  balances: {
    main: fromMinorUnit(wallet.mainBalance),
    referral: fromMinorUnit(wallet.referralBalance),
  },
  rawBalances: {
    main: wallet.mainBalance,
    referral: wallet.referralBalance,
  },
  createdAt: wallet.createdAt,
  updatedAt: wallet.updatedAt,
});

export const serializeTransaction = (transaction) => ({
  id: transaction._id,
  user: transaction.user,
  type: transaction.type,
  walletType: transaction.walletType,
  direction: transaction.direction,
  amount: fromMinorUnit(transaction.amount),
  balanceBefore: fromMinorUnit(transaction.balanceBefore),
  balanceAfter: fromMinorUnit(transaction.balanceAfter),
  currency: transaction.currency,
  reference: transaction.reference,
  provider: transaction.provider,
  providerReference: transaction.providerReference,
  status: transaction.status,
  narration: transaction.narration,
  token: transaction.metadata?.token,
  tokenNumber: transaction.metadata?.token,
  units: transaction.metadata?.units,
  metadata: transaction.metadata,
  createdAt: transaction.createdAt,
});

export const generateTransactionReference = (prefix = "BXP") => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}_${timestamp}_${random}`;
};

export const getOrCreateWallet = async (userId) => {
  let wallet = await Wallet.findOne({ user: userId });

  if (!wallet) {
    wallet = await Wallet.create({ user: userId });
  }

  return wallet;
};

const getBalanceField = (walletType) => {
  if (walletType === "main") {
    return "mainBalance";
  }

  if (walletType === "referral") {
    return "referralBalance";
  }

  throw new Error("Invalid wallet type");
};

export const creditWallet = async ({
  userId,
  amount,
  amountInMinorUnit,
  walletType = "main",
  type = "credit",
  reference = generateTransactionReference("CR"),
  provider = "billxpress",
  providerReference,
  narration,
  metadata = {},
}) => {
  const normalizedAmount = amountInMinorUnit || toMinorUnit(amount);
  const balanceField = getBalanceField(walletType);
  await getOrCreateWallet(userId);
  const wallet = await Wallet.findOneAndUpdate(
    { user: userId },
    { $inc: { [balanceField]: normalizedAmount } },
    { new: false }
  );

  if (!wallet) {
    throw new Error("Wallet not found");
  }

  const balanceBefore = wallet[balanceField];
  const balanceAfter = balanceBefore + normalizedAmount;

  const transaction = await Transaction.create({
    user: userId,
    type,
    walletType,
    direction: "credit",
    amount: normalizedAmount,
    balanceBefore,
    balanceAfter,
    reference,
    provider,
    providerReference,
    narration,
    metadata,
  });

  wallet[balanceField] = balanceAfter;

  return { wallet, transaction };
};

export const debitWallet = async ({
  userId,
  amount,
  amountInMinorUnit,
  walletType = "main",
  type = "debit",
  reference = generateTransactionReference("DR"),
  provider = "billxpress",
  providerReference,
  narration,
  metadata = {},
}) => {
  const normalizedAmount = amountInMinorUnit || toMinorUnit(amount);
  const balanceField = getBalanceField(walletType);
  await getOrCreateWallet(userId);
  const wallet = await Wallet.findOneAndUpdate(
    {
      user: userId,
      [balanceField]: { $gte: normalizedAmount },
    },
    { $inc: { [balanceField]: -normalizedAmount } },
    { new: false }
  );

  if (!wallet) {
    const error = new Error("Insufficient wallet balance");
    error.statusCode = 400;
    throw error;
  }

  const balanceBefore = wallet[balanceField];
  const balanceAfter = balanceBefore - normalizedAmount;

  const transaction = await Transaction.create({
    user: userId,
    type,
    walletType,
    direction: "debit",
    amount: normalizedAmount,
    balanceBefore,
    balanceAfter,
    reference,
    provider,
    providerReference,
    narration,
    metadata,
  });

  wallet[balanceField] = balanceAfter;

  return { wallet, transaction };
};

export const verifyTransactionPin = async (user, transactionPin) => {
  if (!transactionPin) {
    const error = new Error("Transaction PIN is required");
    error.statusCode = 400;
    throw error;
  }

  const isMatch = await bcrypt.compare(transactionPin, user.transactionPin);

  if (!isMatch) {
    const error = new Error("Invalid transaction PIN");
    error.statusCode = 400;
    throw error;
  }
};
