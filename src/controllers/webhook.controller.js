import crypto from "crypto";
import FundingIntent from "../models/fundingIntent.model.js";
import Transaction from "../models/transaction.model.js";
import VirtualAccount from "../models/virtualAccount.model.js";
import WebhookEvent from "../models/webhookEvent.model.js";
import {
  creditWallet,
  fromMinorUnit,
  generateTransactionReference,
  toMinorUnit,
} from "../services/wallet.service.js";
import { calculateFundingFee } from "../services/fundingFee.service.js";
import { createNotificationBestEffort } from "../services/notification.service.js";

const getRawPayload = (req) => {
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString();
  }

  return JSON.stringify(req.body || {});
};

const getPocketFiSignature = (req) =>
  req.headers["http_pocketfi_signature"] ||
  req.headers["pocketfi-signature"] ||
  req.headers["x-pocketfi-signature"];

const getMonnifySignature = (req) =>
  req.headers["monnify-signature"] || req.headers["x-monnify-signature"];

const isValidPocketFiSignature = (payload, signature) => {
  const secret = process.env.POCKETFI_SECRET_KEY;

  if (!secret || !signature) {
    return false;
  }

  const hash = crypto
    .createHmac("sha512", secret)
    .update(payload)
    .digest("hex");

  const signatureBuffer = Buffer.from(String(signature), "hex");
  const hashBuffer = Buffer.from(hash, "hex");

  return (
    signatureBuffer.length === hashBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, hashBuffer)
  );
};

const isValidMonnifySignature = (payload, signature) => {
  const secret = process.env.MONNIFY_SECRET_KEY;

  if (!secret || !signature) {
    return false;
  }

  const hash = crypto
    .createHmac("sha512", secret)
    .update(payload)
    .digest("hex");
  const signatureBuffer = Buffer.from(String(signature), "hex");
  const hashBuffer = Buffer.from(hash, "hex");

  return (
    signatureBuffer.length === hashBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, hashBuffer)
  );
};

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const extractPocketFiFundingDetails = (payload) => {
  const grossAmount = pickFirst(
    payload.order?.amount,
    payload.transaction?.amount,
    payload.data?.amount,
    payload.amount
  );
  const settlementAmount = pickFirst(
    payload.order?.settlement_amount,
    payload.transaction?.settlement_amount,
    payload.data?.settlement_amount,
    payload.settlement_amount
  );

  const providerReference = pickFirst(
    payload.transaction?.reference,
    payload.transaction?.transaction_reference,
    payload.data?.reference,
    payload.reference,
    payload.payment_id
  );

  const accountNumber = pickFirst(
    payload.account?.accountNumber,
    payload.account?.account_number,
    payload.virtual_account?.accountNumber,
    payload.virtual_account?.account_number,
    payload.data?.accountNumber,
    payload.data?.account_number,
    payload.accountNumber,
    payload.account_number
  );

  return {
    amount: grossAmount || settlementAmount,
    settlementAmount,
    providerReference,
    accountNumber,
  };
};

const extractMonnifyFundingDetails = (payload) => {
  const data = payload.eventData || payload.data || payload;
  const paymentReference = pickFirst(
    data.paymentReference,
    data.payment_reference,
    payload.paymentReference,
    payload.payment_reference
  );
  const providerReference = pickFirst(
    data.transactionReference,
    data.transaction_reference,
    data.transactionHash,
    payload.transactionReference,
    payload.transaction_reference
  );
  const amountPaid = pickFirst(
    data.amountPaid,
    data.amount_paid,
    data.paidAmount,
    data.amount
  );
  const paymentStatus = String(
    pickFirst(data.paymentStatus, data.status, payload.eventType, "")
  ).toUpperCase();

  return {
    paymentReference,
    providerReference,
    amountPaid,
    paymentStatus,
  };
};

export const handlePocketFiWebhook = async (req, res) => {
  const rawPayload = getRawPayload(req);
  const signature = getPocketFiSignature(req);

  if (!isValidPocketFiSignature(rawPayload, signature)) {
    await WebhookEvent.create({
      provider: "pocketfi",
      signature,
      payload: Buffer.isBuffer(req.body)
        ? { rawPayload }
        : req.body || {},
      processingError: "Invalid signature",
    });

    return res.status(400).json({
      message: "Invalid signature",
    });
  }

  const payload = Buffer.isBuffer(req.body)
    ? JSON.parse(rawPayload || "{}")
    : req.body || {};
  const { amount, settlementAmount, providerReference, accountNumber } =
    extractPocketFiFundingDetails(payload);
  const webhookEvent = await WebhookEvent.create({
    provider: "pocketfi",
    signature,
    eventReference: providerReference,
    payload,
  });

  try {
    if (!amount || !providerReference) {
      throw new Error("Webhook payload is missing amount or transaction reference");
    }

    const existingTransaction = await Transaction.findOne({
      provider: "pocketfi",
      providerReference,
    });

    if (existingTransaction) {
      webhookEvent.processed = true;
      await webhookEvent.save();

      return res.json({
        message: "Webhook already processed",
      });
    }

    const normalizedAccountNumber = String(accountNumber);
    const virtualAccount = await VirtualAccount.findOne({
      $or: [
        { accountNumber: normalizedAccountNumber },
        { "accounts.accountNumber": normalizedAccountNumber },
      ],
    });

    if (!virtualAccount) {
      throw new Error("Could not match webhook to a user virtual account");
    }

    const grossAmountInMinorUnit = toMinorUnit(amount);
    const settlementAmountInMinorUnit = settlementAmount
      ? toMinorUnit(settlementAmount)
      : null;
    const feeResult = settlementAmountInMinorUnit
      ? {
          fee: Math.max(0, grossAmountInMinorUnit - settlementAmountInMinorUnit),
          amountToReceive: settlementAmountInMinorUnit,
        }
      : calculateFundingFee(grossAmountInMinorUnit, "pocketfi");

    if (feeResult.amountToReceive <= 0) {
      throw new Error("Funding amount after fee must be greater than zero");
    }

    const creditResult = await creditWallet({
      userId: virtualAccount.user,
      amountInMinorUnit: feeResult.amountToReceive,
      walletType: "main",
      type: "funding",
      reference: generateTransactionReference("PFI"),
      provider: "pocketfi",
      providerReference,
      narration: "Wallet funding via PocketFi virtual account",
      metadata: {
        ...payload,
        fee: feeResult.fee,
        grossAmount: grossAmountInMinorUnit,
        amountCredited: feeResult.amountToReceive,
        feePaidBy: "user",
      },
    });

    await createNotificationBestEffort({
      userId: virtualAccount.user,
      title: "Wallet funded successfully",
      message: `Your wallet has been credited with NGN ${fromMinorUnit(
        feeResult.amountToReceive
      )}.`,
      type: "wallet_funding_success",
      channel: "both",
      priority: "normal",
      data: {
        provider: "pocketfi",
        amount: fromMinorUnit(feeResult.amountToReceive),
        grossAmount: fromMinorUnit(grossAmountInMinorUnit),
        fee: fromMinorUnit(feeResult.fee),
        reference: creditResult.transaction.reference,
        providerReference,
      },
    });

    webhookEvent.processed = true;
    await webhookEvent.save();

    res.json({
      message: "Webhook processed successfully",
    });
  } catch (error) {
    webhookEvent.processingError = error.message;
    await webhookEvent.save();

    res.status(400).json({
      message: error.message,
    });
  }
};

export const handleMonnifyWebhook = async (req, res) => {
  const rawPayload = getRawPayload(req);
  const signature = getMonnifySignature(req);

  if (!isValidMonnifySignature(rawPayload, signature)) {
    await WebhookEvent.create({
      provider: "monnify",
      signature,
      payload: Buffer.isBuffer(req.body)
        ? { rawPayload }
        : req.body || {},
      processingError: "Invalid signature",
    });

    return res.status(400).json({
      message: "Invalid signature",
    });
  }

  const payload = Buffer.isBuffer(req.body)
    ? JSON.parse(rawPayload || "{}")
    : req.body || {};
  const { paymentReference, providerReference, amountPaid, paymentStatus } =
    extractMonnifyFundingDetails(payload);
  const webhookEvent = await WebhookEvent.create({
    provider: "monnify",
    signature,
    eventReference: providerReference || paymentReference,
    payload,
  });

  try {
    if (!paymentReference || !providerReference) {
      throw new Error("Webhook payload is missing payment reference");
    }

    if (
      paymentStatus &&
      !["PAID", "SUCCESS", "SUCCESSFUL", "TRANSACTION.COMPLETED"].includes(
        paymentStatus
      )
    ) {
      webhookEvent.processed = true;
      await webhookEvent.save();

      return res.json({
        message: "Webhook ignored",
      });
    }

    const intent = await FundingIntent.findOne({
      paymentReference,
      provider: "monnify",
    });

    if (!intent) {
      throw new Error("Could not match webhook to a funding intent");
    }

    const existingTransaction = await Transaction.findOne({
      provider: "monnify",
      providerReference,
    });

    if (existingTransaction || intent.status === "paid") {
      webhookEvent.processed = true;
      await webhookEvent.save();

      return res.json({
        message: "Webhook already processed",
      });
    }

    const paidAmountInMinorUnit = Math.round(Number(amountPaid || 0) * 100);

    if (paidAmountInMinorUnit < intent.amount) {
      throw new Error("Paid amount is less than expected funding amount");
    }

    const creditResult = await creditWallet({
      userId: intent.user,
      amountInMinorUnit: intent.amountToReceive,
      walletType: "main",
      type: "funding",
      reference: generateTransactionReference("MNF"),
      provider: "monnify",
      providerReference,
      narration: "Wallet funding via Monnify one-time transfer",
      metadata: payload,
    });

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
        providerReference,
        paymentReference,
      },
    });

    intent.status = "paid";
    intent.paidAt = new Date();
    await intent.save();

    webhookEvent.processed = true;
    await webhookEvent.save();

    res.json({
      message: "Webhook processed successfully",
    });
  } catch (error) {
    webhookEvent.processingError = error.message;
    await webhookEvent.save();

    res.status(400).json({
      message: error.message,
    });
  }
};
