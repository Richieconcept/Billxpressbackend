import Transaction from "../models/transaction.model.js";
import User from "../models/user.model.js";
import VirtualAccount from "../models/virtualAccount.model.js";
import {
  confirmFundingIntentStatus,
  createOneTimeFundingIntent,
  serializeFundingIntent,
} from "../services/fundingIntent.service.js";
import {
  getOrCreateVirtualAccountForUser,
  serializeVirtualAccount,
} from "../services/virtualAccount.service.js";
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
} from "../services/wallet.service.js";
import { createNotificationBestEffort } from "../services/notification.service.js";
import { resolvePaystackBankAccount } from "../services/paystack.service.js";

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
      virtualAccount: await serializeVirtualAccount(virtualAccount),
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
        virtualAccount: await serializeVirtualAccount(result.virtualAccount),
      });
    }

    res.status(201).json({
      message: "Virtual account created successfully",
      virtualAccount: await serializeVirtualAccount(result.virtualAccount),
    });
  } catch (error) {
    sendWalletError(res, "Could not create virtual account", error);
  }
};

export const createFundingIntent = async (req, res) => {
  try {
    const intent = await createOneTimeFundingIntent(req.user, req.body?.amount);

    res.status(201).json({
      message: "Funding account created successfully",
      fundingIntent: await serializeFundingIntent(intent),
    });
  } catch (error) {
    sendWalletError(res, "Could not create funding account", error);
  }
};

export const confirmFundingIntent = async (req, res) => {
  try {
    const result = await confirmFundingIntentStatus(
      req.user,
      req.params.fundingIntentId
    );
    const response = {
      message:
        result.status === "paid"
          ? "Payment confirmed and wallet credited"
          : "Payment has not been confirmed yet",
      status: result.status,
      alreadyProcessed: Boolean(result.alreadyProcessed),
      fundingIntent: await serializeFundingIntent(result.intent),
    };

    if (result.status === "pending") {
      response.message =
        "We have not received this transfer yet. Please wait a moment and try again.";
    }

    if (result.status === "expired") {
      response.message =
        "This funding account has expired. Please create a new funding account.";
    }

    if (result.status === "failed") {
      response.message =
        "Monnify marked this payment as failed. Please create a new funding account.";
    }

    if (result.wallet) {
      response.wallet = serializeWallet(result.wallet);
    }

    if (result.transaction) {
      response.transaction = serializeTransaction(result.transaction);
    }

    res.json(response);
  } catch (error) {
    sendWalletError(res, "Could not confirm funding payment", error);
  }
};

export const resolveTransferAccount = async (req, res) => {
  try {
    const account = await resolvePaystackBankAccount({
      accountNumber: req.body?.accountNumber,
      bankCode: req.body?.bankCode,
    });

    res.json({
      message: "Account resolved successfully",
      account,
    });
  } catch (error) {
    sendWalletError(res, "Could not resolve account name", error);
  }
};

export const redeemReferralBalance = async (req, res) => {
  try {
    const amount = toMinorUnit(req.body?.amount);
    const minimumAmount = toMinorUnit(
      process.env.REFERRAL_MIN_REDEEM_AMOUNT || 100
    );
    const user = await User.findById(req.user._id).select("+transactionPin");

    if (amount < minimumAmount) {
      return res.status(400).json({
        message: `Minimum referral redeem amount is ${process.env.REFERRAL_MIN_REDEEM_AMOUNT || 100}`,
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

    await createNotificationBestEffort({
      userId: user._id,
      title: "Referral earnings redeemed",
      message: `NGN ${fromMinorUnit(
        amount
      )} has been moved from referral balance to your main wallet.`,
      type: "referral_redeem_success",
      channel: "in_app",
      priority: "normal",
      data: {
        amount: fromMinorUnit(amount),
        debitReference: debitResult.transaction.reference,
        creditReference: creditResult.transaction.reference,
      },
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

    await createNotificationBestEffort({
      userId,
      title: "Referral reward received",
      message: `You received NGN ${amount} referral reward.`,
      type: "referral_reward",
      channel: "both",
      priority: "normal",
      data: {
        amount: Number(amount),
        reference: result.transaction.reference,
      },
      createdBy: req.user._id,
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
