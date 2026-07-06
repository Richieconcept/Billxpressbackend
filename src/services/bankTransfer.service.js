import User from "../models/user.model.js";
import { createNotificationBestEffort } from "./notification.service.js";
import {
  createMapleradLocalTransfer,
  resolveMapleradInstitutionAccount,
} from "./maplerad.service.js";
import {
  creditWallet,
  debitWallet,
  fromMinorUnit,
  generateTransactionReference,
  serializeTransaction,
  serializeWallet,
  verifyTransactionPin,
} from "./wallet.service.js";
import {
  getBankTransferQuote,
  serializeBankTransferQuote,
} from "./bankTransferFee.service.js";

const normalizeName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

const isSuccessfulTransferStatus = (status) =>
  ["SUCCESS", "SUCCESSFUL", "COMPLETED", "PAID"].includes(
    String(status || "").toUpperCase()
  );

const isFailedTransferStatus = (status) =>
  ["FAILED", "FAILURE", "DECLINED", "REJECTED"].includes(
    String(status || "").toUpperCase()
  );

export const sendMapleradBankTransfer = async ({
  userId,
  amount,
  accountNumber,
  accountName,
  mapleradBankCode,
  narration,
  transactionPin,
}) => {
  const quote = await getBankTransferQuote(amount);
  const { amountInMinorUnit, feeInMinorUnit, totalDebitInMinorUnit } = quote;
  const normalizedAccountName = normalizeName(accountName);
  const transferReason =
    String(narration || "").trim() || "BillXpress wallet transfer";

  if (!transactionPin) {
    const error = new Error("Transaction PIN is required");
    error.statusCode = 400;
    throw error;
  }

  if (!mapleradBankCode || !accountNumber) {
    const error = new Error(
      "Account number and Maplerad bank code are required"
    );
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedAccountName) {
    const error = new Error("Resolved account name is required");
    error.statusCode = 400;
    throw error;
  }

  const user = await User.findById(userId).select("+transactionPin");

  if (!user || !user.isActive) {
    const error = new Error("User account is not active");
    error.statusCode = 401;
    throw error;
  }

  await verifyTransactionPin(user, transactionPin);

  const resolvedAccount = await resolveMapleradInstitutionAccount({
    accountNumber,
    bankCode: mapleradBankCode,
  });

  if (normalizeName(resolvedAccount.accountName) !== normalizedAccountName) {
    const error = new Error("Resolved account name has changed. Please verify again.");
    error.statusCode = 400;
    error.resolvedAccount = resolvedAccount;
    throw error;
  }

  const reference = generateTransactionReference("TRF");
  const debitResult = await debitWallet({
    userId: user._id,
    amountInMinorUnit: totalDebitInMinorUnit,
    walletType: "main",
    type: "transfer",
    reference,
    provider: "maplerad",
    narration: `Bank transfer to ${resolvedAccount.accountName}`,
    metadata: {
      service: "bank_transfer",
      accountNumber: resolvedAccount.accountNumber,
      accountName: resolvedAccount.accountName,
      mapleradBankCode: String(mapleradBankCode),
      accountResolver: "maplerad",
      reason: transferReason,
      amount: fromMinorUnit(amountInMinorUnit),
      transferFee: fromMinorUnit(feeInMinorUnit),
      totalWalletDebit: fromMinorUnit(totalDebitInMinorUnit),
      recipientReceives: fromMinorUnit(amountInMinorUnit),
    },
  });
  debitResult.transaction.status = "pending";
  await debitResult.transaction.save();

  try {
    const transferResult = await createMapleradLocalTransfer({
      amountInMinorUnit,
      accountNumber: resolvedAccount.accountNumber,
      bankCode: mapleradBankCode,
      reference,
      reason: transferReason,
    });

    if (isFailedTransferStatus(transferResult.status)) {
      const error = new Error("Maplerad marked this transfer as failed");
      error.statusCode = 502;
      error.providerResponse = transferResult.providerResponse;
      throw error;
    }

    debitResult.transaction.providerReference = transferResult.providerReference;
    debitResult.transaction.status = isSuccessfulTransferStatus(transferResult.status)
      ? "successful"
      : "pending";
    debitResult.transaction.metadata = {
      ...debitResult.transaction.metadata,
      mapleradStatus: transferResult.status,
      providerRequest: transferResult.requestPayload,
      providerResponse: transferResult.providerResponse,
    };
    await debitResult.transaction.save();

    await createNotificationBestEffort({
      userId: user._id,
      title:
        debitResult.transaction.status === "successful"
          ? "Transfer successful"
          : "Transfer processing",
      message:
        debitResult.transaction.status === "successful"
          ? `NGN ${fromMinorUnit(amountInMinorUnit)} was sent to ${resolvedAccount.accountName}.`
          : `Your NGN ${fromMinorUnit(amountInMinorUnit)} transfer to ${resolvedAccount.accountName} is processing.`,
      type:
        debitResult.transaction.status === "successful"
          ? "bank_transfer_success"
          : "bank_transfer_pending",
      channel: "both",
      priority: "normal",
      data: {
        amount: fromMinorUnit(amountInMinorUnit),
        fee: fromMinorUnit(feeInMinorUnit),
        totalWalletDebit: fromMinorUnit(totalDebitInMinorUnit),
        accountNumber: resolvedAccount.accountNumber,
        accountName: resolvedAccount.accountName,
        reference,
        providerReference: transferResult.providerReference,
      },
    });

    return {
      status: debitResult.transaction.status,
      message:
        debitResult.transaction.status === "successful"
          ? "Transfer successful"
          : "Transfer is processing",
      wallet: debitResult.wallet,
      transaction: debitResult.transaction,
      account: {
        accountNumber: resolvedAccount.accountNumber,
        accountName: resolvedAccount.accountName,
      },
      quote,
      providerResponse: transferResult.providerResponse,
    };
  } catch (error) {
    debitResult.transaction.status = "reversed";
    debitResult.transaction.metadata = {
      ...debitResult.transaction.metadata,
      providerError: error.providerResponse || error.message,
    };
    await debitResult.transaction.save();

    const refundResult = await creditWallet({
      userId: user._id,
      amountInMinorUnit: totalDebitInMinorUnit,
      walletType: "main",
      type: "reversal",
      reference: `${reference}_REV`,
      provider: "maplerad",
      narration: `Refund for failed bank transfer to ${resolvedAccount.accountName}`,
      metadata: {
        service: "bank_transfer",
        originalReference: reference,
        accountNumber: resolvedAccount.accountNumber,
        accountName: resolvedAccount.accountName,
        reason: error.message,
        transferAmount: fromMinorUnit(amountInMinorUnit),
        transferFee: fromMinorUnit(feeInMinorUnit),
      },
    });

    await createNotificationBestEffort({
      userId: user._id,
      title: "Transfer failed",
      message: `Your transfer to ${resolvedAccount.accountName} failed and has been refunded.`,
      type: "bank_transfer_failed",
      channel: "both",
      priority: "normal",
      data: {
        amount: fromMinorUnit(amountInMinorUnit),
        accountNumber: resolvedAccount.accountNumber,
        accountName: resolvedAccount.accountName,
        reference,
        refundReference: refundResult.transaction.reference,
      },
    });

    error.wallet = refundResult.wallet;
    error.transaction = debitResult.transaction;
    error.refundTransaction = refundResult.transaction;
    throw error;
  }
};

export const serializeBankTransferResult = (result) => ({
  status: result.status,
  message: result.message,
  account: result.account,
  wallet: serializeWallet(result.wallet),
  transaction: serializeTransaction(result.transaction),
  quote: serializeBankTransferQuote(result.quote),
  providerResponse:
    process.env.NODE_ENV === "production" ? undefined : result.providerResponse,
});

export const serializeFailedBankTransfer = (error) => ({
  message: error.message,
  wallet: error.wallet ? serializeWallet(error.wallet) : undefined,
  transaction: error.transaction
    ? serializeTransaction(error.transaction)
    : undefined,
  refundTransaction: error.refundTransaction
    ? serializeTransaction(error.refundTransaction)
    : undefined,
  resolvedAccount: error.resolvedAccount,
  providerResponse:
    process.env.NODE_ENV === "production" ? undefined : error.providerResponse,
});
