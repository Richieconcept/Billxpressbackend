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
import { resolveMapleradInstitutionAccount } from "../services/maplerad.service.js";
import {
  sendMapleradBankTransfer,
  serializeBankTransferResult,
  serializeFailedBankTransfer,
} from "../services/bankTransfer.service.js";
import {
  getBankTransferQuote,
  serializeBankTransferQuote,
} from "../services/bankTransferFee.service.js";
import {
  getTransferBanks,
  suggestTransferBanks,
} from "../services/transferBank.service.js";
import {
  getMinimumReferralRedeemAmountInMinorUnit,
  getReferralRedemptionEligibility,
} from "../services/referral.service.js";
import {
  calculateFundingFee,
  serializeFundingFee,
} from "../services/fundingFee.service.js";

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

export const previewFundingFee = async (req, res) => {
  try {
    const amountInMinorUnit = toMinorUnit(req.body?.amount);

    if (amountInMinorUnit <= 0) {
      return res.status(400).json({
        message: "Amount must be greater than zero",
      });
    }

    const provider = String(req.body?.provider || "maplerad")
      .trim()
      .toLowerCase();
    const result = await calculateFundingFee(amountInMinorUnit, provider);

    res.json({
      quote: {
        provider,
        transferAmount: fromMinorUnit(amountInMinorUnit),
        fee: fromMinorUnit(result.fee),
        walletCredit: fromMinorUnit(result.amountToReceive),
        feePolicy: await serializeFundingFee(provider),
      },
    });
  } catch (error) {
    sendWalletError(res, "Could not calculate funding fee", error);
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
    const account = await resolveMapleradInstitutionAccount({
      accountNumber: req.body?.accountNumber,
      bankCode: req.body?.mapleradBankCode || req.body?.bankCode,
    });

    res.json({
      message: "Account resolved successfully",
      account,
    });
  } catch (error) {
    sendWalletError(res, "Could not resolve account name", error);
  }
};

export const getTransferBankList = async (req, res) => {
  try {
    const result = await getTransferBanks({
      includeUnmapped: req.query?.includeUnmapped === "true",
    });

    res.json({
      banks: result.banks,
      meta: result.meta,
      cached: result.cached,
    });
  } catch (error) {
    sendWalletError(res, "Could not fetch transfer banks", error);
  }
};

export const suggestTransferBankList = async (req, res) => {
  try {
    const result = await suggestTransferBanks({
      accountNumber: req.body?.accountNumber,
      query: req.body?.query || req.body?.bankName,
    });

    res.json(result);
  } catch (error) {
    sendWalletError(res, "Could not suggest transfer banks", error);
  }
};

export const createBankTransfer = async (req, res) => {
  try {
    const result = await sendMapleradBankTransfer({
      userId: req.user._id,
      amount: req.body?.amount,
      accountNumber: req.body?.accountNumber,
      accountName: req.body?.accountName,
      mapleradBankCode: req.body?.mapleradBankCode,
      narration: req.body?.narration,
      transactionPin: req.body?.transactionPin,
    });

    res.status(201).json(serializeBankTransferResult(result));
  } catch (error) {
    const statusCode = error.statusCode || 500;

    if (error.transaction || error.wallet || error.resolvedAccount) {
      return res.status(statusCode).json(serializeFailedBankTransfer(error));
    }

    sendWalletError(res, "Could not send transfer", error);
  }
};

export const previewBankTransfer = async (req, res) => {
  try {
    const quote = await getBankTransferQuote(req.body?.amount);
    res.json({ quote: serializeBankTransferQuote(quote) });
  } catch (error) {
    sendWalletError(res, "Could not calculate bank transfer fee", error);
  }
};

export const redeemReferralBalance = async (req, res) => {
  try {
    const amount = toMinorUnit(req.body?.amount);
    const user = await User.findById(req.user._id).select("+transactionPin");

    await verifyTransactionPin(user, req.body?.transactionPin);

    const minimumRedeemAmount = getMinimumReferralRedeemAmountInMinorUnit();
    if (amount < minimumRedeemAmount) {
      const error = new Error(
        `The minimum referral withdrawal is NGN ${fromMinorUnit(
          minimumRedeemAmount
        )}.`
      );
      error.statusCode = 400;
      throw error;
    }

    const [wallet, eligibility] = await Promise.all([
      getOrCreateWallet(user._id),
      getReferralRedemptionEligibility(user._id),
    ]);
    const withdrawableAmount = Math.max(
      wallet.referralBalance - eligibility.lockedAmountInMinorUnit,
      0
    );

    if (amount > withdrawableAmount) {
      const error = new Error(
        eligibility.unqualifiedReferrals > 0
          ? `A NGN 300 reward earned from one referred user is locked until that user buys a service worth at least NGN ${fromMinorUnit(
              eligibility.minimumServicePurchaseInMinorUnit
            )}. You can currently redeem NGN ${fromMinorUnit(withdrawableAmount)}.`
          : "Insufficient referral balance"
      );
      error.statusCode = 400;
      throw error;
    }

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

const parseAdminWalletAdjustment = ({ req, direction }) => {
  const amountInMinorUnit = toMinorUnit(req.body?.amount);
  const walletType = String(req.body?.walletType || "main")
    .trim()
    .toLowerCase();

  if (!["main", "referral"].includes(walletType)) {
    const error = new Error("walletType must be main or referral");
    error.statusCode = 400;
    throw error;
  }

  const reason = String(req.body?.reason || req.body?.narration || "").trim();

  if (!reason) {
    const error = new Error("Reason is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    amountInMinorUnit,
    amount: fromMinorUnit(amountInMinorUnit),
    walletType,
    reason,
    referencePrefix: direction === "credit" ? "ADMINCR" : "ADMINDR",
  };
};

export const adminCreditUserWallet = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.userId);

    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({
        message: "Target user not found or inactive",
      });
    }

    const adjustment = parseAdminWalletAdjustment({ req, direction: "credit" });
    const result = await creditWallet({
      userId: targetUser._id,
      amountInMinorUnit: adjustment.amountInMinorUnit,
      walletType: adjustment.walletType,
      type: "credit",
      reference: generateTransactionReference(adjustment.referencePrefix),
      provider: "billxpress_admin",
      narration: adjustment.reason,
      metadata: {
        adjustedBy: req.user._id,
        adjustmentType: "admin_credit",
        reason: adjustment.reason,
      },
    });

    await createNotificationBestEffort({
      userId: targetUser._id,
      title: "Wallet credited",
      message: `Your ${adjustment.walletType} wallet has been credited with NGN ${adjustment.amount}.`,
      type: "wallet_funding_success",
      channel: "both",
      priority: "normal",
      data: {
        amount: adjustment.amount,
        walletType: adjustment.walletType,
        reference: result.transaction.reference,
        reason: adjustment.reason,
      },
      createdBy: req.user._id,
    });

    res.status(201).json({
      message: "Wallet credited successfully",
      wallet: serializeWallet(result.wallet),
      transaction: serializeTransaction(result.transaction),
    });
  } catch (error) {
    sendWalletError(res, "Could not credit user wallet", error);
  }
};

export const adminDebitUserWallet = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.userId);

    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({
        message: "Target user not found or inactive",
      });
    }

    const adjustment = parseAdminWalletAdjustment({ req, direction: "debit" });
    const result = await debitWallet({
      userId: targetUser._id,
      amountInMinorUnit: adjustment.amountInMinorUnit,
      walletType: adjustment.walletType,
      type: "debit",
      reference: generateTransactionReference(adjustment.referencePrefix),
      provider: "billxpress_admin",
      narration: adjustment.reason,
      metadata: {
        adjustedBy: req.user._id,
        adjustmentType: "admin_debit",
        reason: adjustment.reason,
      },
    });

    await createNotificationBestEffort({
      userId: targetUser._id,
      title: "Wallet debited",
      message: `Your ${adjustment.walletType} wallet has been debited by NGN ${adjustment.amount}.`,
      type: "system",
      channel: "both",
      priority: "high",
      data: {
        amount: adjustment.amount,
        walletType: adjustment.walletType,
        reference: result.transaction.reference,
        reason: adjustment.reason,
      },
      createdBy: req.user._id,
    });

    res.status(201).json({
      message: "Wallet debited successfully",
      wallet: serializeWallet(result.wallet),
      transaction: serializeTransaction(result.transaction),
    });
  } catch (error) {
    sendWalletError(res, "Could not debit user wallet", error);
  }
};
