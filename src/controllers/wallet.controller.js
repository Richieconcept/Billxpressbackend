import Transaction from "../models/transaction.model.js";
import User from "../models/user.model.js";
import VirtualAccount from "../models/virtualAccount.model.js";
import {
  createMonnifyFundingIntent,
  serializeFundingIntent,
} from "../services/fundingIntent.service.js";
import {
  getOrCreateVirtualAccountForUser,
  serializeVirtualAccount,
} from "../services/virtualAccount.service.js";
import {
  creditWallet,
  debitWallet,
  generateTransactionReference,
  getOrCreateWallet,
  serializeTransaction,
  serializeWallet,
  toMinorUnit,
  verifyTransactionPin,
} from "../services/wallet.service.js";

const sendWalletError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
    providerResponse:
      process.env.NODE_ENV === "production" ? undefined : error.providerResponse,
  });
};

export const getWallet = async (req, res) => {
  try {
    const wallet = await getOrCreateWallet(req.user._id);

    res.json({
      wallet: serializeWallet(wallet),
    });
  } catch (error) {
    sendWalletError(res, "Could not fetch wallet", error);
  }
};

export const getTransactions = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const transactions = await Transaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({
      transactions: transactions.map((transaction) =>
        serializeTransaction(transaction)
      ),
    });
  } catch (error) {
    sendWalletError(res, "Could not fetch transactions", error);
  }
};

export const getVirtualAccount = async (req, res) => {
  try {
    const virtualAccount = await VirtualAccount.findOne({ user: req.user._id });

    if (!virtualAccount) {
      return res.status(404).json({
        message: "Virtual account has not been created",
      });
    }

    res.json({
      virtualAccount: serializeVirtualAccount(virtualAccount),
    });
  } catch (error) {
    sendWalletError(res, "Could not fetch virtual account", error);
  }
};

export const createVirtualAccount = async (req, res) => {
  try {
    const result = await getOrCreateVirtualAccountForUser(req.user);

    if (!result.created) {
      return res.json({
        message: "Virtual account already exists",
        virtualAccount: serializeVirtualAccount(result.virtualAccount),
      });
    }

    res.status(201).json({
      message: "Virtual account created successfully",
      virtualAccount: serializeVirtualAccount(result.virtualAccount),
    });
  } catch (error) {
    sendWalletError(res, "Could not create virtual account", error);
  }
};

export const createFundingIntent = async (req, res) => {
  try {
    const intent = await createMonnifyFundingIntent(req.user, req.body?.amount);

    res.status(201).json({
      message: "Funding account created successfully",
      fundingIntent: serializeFundingIntent(intent),
    });
  } catch (error) {
    sendWalletError(res, "Could not create funding account", error);
  }
};

export const redeemReferralBalance = async (req, res) => {
  try {
    const amount = toMinorUnit(req.body?.amount);
    const minimumAmount = toMinorUnit(
      process.env.REFERRAL_MIN_REDEEM_AMOUNT || 1000
    );
    const user = await User.findById(req.user._id).select("+transactionPin");

    if (amount < minimumAmount) {
      return res.status(400).json({
        message: `Minimum referral redeem amount is ${process.env.REFERRAL_MIN_REDEEM_AMOUNT || 1000}`,
      });
    }

    await verifyTransactionPin(user, req.body?.transactionPin);

    const reference = generateTransactionReference("REF");
    const debitResult = await debitWallet({
      userId: user._id,
      amountInMinorUnit: amount,
      walletType: "referral",
      type: "referral_redeem",
      reference: `${reference}_DR`,
      narration: "Referral earnings redeemed to main wallet",
    });

    const creditResult = await creditWallet({
      userId: user._id,
      amountInMinorUnit: amount,
      walletType: "main",
      type: "referral_redeem",
      reference: `${reference}_CR`,
      narration: "Referral earnings credited to main wallet",
    });

    res.json({
      message: "Referral earnings redeemed successfully",
      wallet: serializeWallet(creditResult.wallet),
      transactions: [
        serializeTransaction(debitResult.transaction),
        serializeTransaction(creditResult.transaction),
      ],
    });
  } catch (error) {
    sendWalletError(res, "Could not redeem referral earnings", error);
  }
};

export const adminCreditReferralBalance = async (req, res) => {
  try {
    const { userId, amount, narration } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({
        message: "User ID and amount are required",
      });
    }

    const result = await creditWallet({
      userId,
      amount,
      walletType: "referral",
      type: "referral_earning",
      reference: generateTransactionReference("REFEARN"),
      narration: narration || "Referral earning credited",
      metadata: {
        creditedBy: req.user._id,
      },
    });

    res.status(201).json({
      message: "Referral balance credited successfully",
      wallet: serializeWallet(result.wallet),
      transaction: serializeTransaction(result.transaction),
    });
  } catch (error) {
    sendWalletError(res, "Could not credit referral balance", error);
  }
};
