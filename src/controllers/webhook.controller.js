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
import { processFirstDepositReferralRewardBestEffort } from "../services/referral.service.js";

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

const getMapleradSignature = (req) => req.headers["svix-signature"];

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

const isValidMapleradSignature = (payload, req) => {
  const secret = process.env.MAPLERAD_WEBHOOK_SECRET;
  const svixId = req.headers["svix-id"];
  const svixTimestamp = req.headers["svix-timestamp"];
  const svixSignature = getMapleradSignature(req);

  if (!secret || !svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  const timestamp = Number(svixTimestamp);
  const toleranceSeconds = Number(
    process.env.MAPLERAD_WEBHOOK_TOLERANCE_SECONDS || 300
  );

  if (
    Number.isFinite(timestamp) &&
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds
  ) {
    return false;
  }

  const secretParts = String(secret).split("_");
  const secretBytes = Buffer.from(secretParts[1] || secret, "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatures = String(svixSignature)
    .split(" ")
    .map((signature) => signature.split(",").pop())
    .filter(Boolean);

  return signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature);

    return (
      signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    );
  });
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

const extractMapleradFundingDetails = (payload) => {
  const data = payload.data || payload.transaction || payload;
  const source = data.source || payload.source || {};
  const account = data.account || data.virtual_account || payload.account || {};
  const event = String(payload.event || data.event || "").toLowerCase();
  const status = String(
    pickFirst(data.status, payload.status, payload.event, "")
  ).toUpperCase();
  const providerReference = pickFirst(
    data.id,
    payload.id,
    data.transaction_id,
    data.transactionId,
    data.reference,
    payload.reference
  );
  const paymentReference = pickFirst(data.reference, payload.reference);
  const accountId = pickFirst(data.account_id, data.accountId, account.id);
  const accountNumber = pickFirst(
    data.account_number,
    data.accountNumber,
    account.account_number,
    account.accountNumber,
    source.account_number,
    source.accountNumber
  );
  const amount = pickFirst(
    data.amount,
    payload.amount,
    data.paid_amount,
    data.paidAmount,
    data.settlement_amount,
    data.settlementAmount
  );

  return {
    event,
    status,
    providerReference,
    paymentReference,
    accountId,
    accountNumber,
    amount,
  };
};

const mapleradAmountToMinorUnit = (amount, expectedAmount) => {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return 0;
  }

  const amountAsMinorUnit = Math.round(numericAmount);
  const amountAsMajorUnit = Math.round(numericAmount * 100);

  if (amountAsMinorUnit >= expectedAmount) {
    return amountAsMinorUnit;
  }

  return amountAsMajorUnit >= expectedAmount ? amountAsMajorUnit : amountAsMinorUnit;
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
    const feeResult = await calculateFundingFee(
      grossAmountInMinorUnit,
      "pocketfi"
    );
    const providerSettlementFee = settlementAmountInMinorUnit
      ? Math.max(0, grossAmountInMinorUnit - settlementAmountInMinorUnit)
      : null;

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
        settlementAmount: settlementAmountInMinorUnit,
        providerSettlementFee,
        amountCredited: feeResult.amountToReceive,
        feePaidBy: "platform",
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
        userReceivesFullAmount: true,
        reference: creditResult.transaction.reference,
        providerReference,
      },
    });

    await processFirstDepositReferralRewardBestEffort({
      referredUserId: virtualAccount.user,
      qualifyingAmountInMinorUnit: grossAmountInMinorUnit,
      fundingTransaction: creditResult.transaction,
      provider: "pocketfi",
      providerReference,
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

    const feeResult = await calculateFundingFee(
      paidAmountInMinorUnit,
      "monnify"
    );
    intent.amountToReceive = paidAmountInMinorUnit;

    const creditResult = await creditWallet({
      userId: intent.user,
      amountInMinorUnit: paidAmountInMinorUnit,
      walletType: "main",
      type: "funding",
      reference: generateTransactionReference("MNF"),
      provider: "monnify",
      providerReference,
      narration: "Wallet funding via Monnify one-time transfer",
      metadata: {
        ...payload,
        fee: feeResult.fee,
        grossAmount: intent.amount,
        amountPaid: paidAmountInMinorUnit,
        amountCredited: paidAmountInMinorUnit,
        feePaidBy: "platform",
      },
    });

    await createNotificationBestEffort({
      userId: intent.user,
      title: "Wallet funded successfully",
      message: `Your wallet has been credited with NGN ${fromMinorUnit(
        paidAmountInMinorUnit
      )}.`,
      type: "wallet_funding_success",
      channel: "both",
      priority: "normal",
      data: {
        provider: "monnify",
        amount: fromMinorUnit(paidAmountInMinorUnit),
        grossAmount: fromMinorUnit(intent.amount),
        fee: fromMinorUnit(feeResult.fee),
        userReceivesFullAmount: true,
        reference: creditResult.transaction.reference,
        providerReference,
        paymentReference,
      },
    });

    await processFirstDepositReferralRewardBestEffort({
      referredUserId: intent.user,
      qualifyingAmountInMinorUnit: intent.amount,
      fundingTransaction: creditResult.transaction,
      provider: "monnify",
      providerReference,
    });

    intent.status = "paid";
    intent.paidAt = new Date();
    intent.fee = feeResult.fee;
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

export const handleMapleradWebhook = async (req, res) => {
  const rawPayload = getRawPayload(req);
  const signature = getMapleradSignature(req);

  if (!isValidMapleradSignature(rawPayload, req)) {
    await WebhookEvent.create({
      provider: "maplerad",
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
  const {
    event,
    status,
    providerReference,
    paymentReference,
    accountId,
    accountNumber,
    amount,
  } = extractMapleradFundingDetails(payload);
  const webhookEvent = await WebhookEvent.create({
    provider: "maplerad",
    signature,
    eventReference: providerReference || paymentReference || accountId,
    payload,
  });

  try {
    if (
      event &&
      !["collection.successful", "account.transaction"].includes(event)
    ) {
      webhookEvent.processed = true;
      await webhookEvent.save();

      return res.json({
        message: "Webhook ignored",
      });
    }

    if (status && !["SUCCESS", "SUCCESSFUL", "PAID"].includes(status)) {
      webhookEvent.processed = true;
      await webhookEvent.save();

      return res.json({
        message: "Webhook ignored",
      });
    }

    const intentMatchConditions = [
      ...(paymentReference ? [{ paymentReference }] : []),
      ...(providerReference ? [{ providerReference }] : []),
      ...(accountId ? [{ providerReference: accountId }] : []),
      ...(accountNumber ? [{ accountNumber: String(accountNumber) }] : []),
    ];

    if (intentMatchConditions.length === 0) {
      throw new Error("Webhook payload is missing funding intent identifiers");
    }

    const intent = await FundingIntent.findOne({
      provider: "maplerad",
      $or: intentMatchConditions,
    });

    if (!intent) {
      throw new Error("Could not match webhook to a funding intent");
    }

    const finalProviderReference =
      providerReference || paymentReference || accountId || intent.providerReference;
    const existingTransaction = await Transaction.findOne({
      provider: "maplerad",
      providerReference: finalProviderReference,
    });

    if (existingTransaction || intent.status === "paid") {
      webhookEvent.processed = true;
      await webhookEvent.save();

      return res.json({
        message: "Webhook already processed",
      });
    }

    const paidAmountInMinorUnit = mapleradAmountToMinorUnit(amount, intent.amount);

    if (paidAmountInMinorUnit > 0 && paidAmountInMinorUnit < intent.amount) {
      throw new Error("Paid amount is less than expected funding amount");
    }

    const amountToCredit = paidAmountInMinorUnit || intent.amount;
    const feeResult = await calculateFundingFee(amountToCredit, "maplerad");
    intent.amountToReceive = amountToCredit;

    const creditResult = await creditWallet({
      userId: intent.user,
      amountInMinorUnit: amountToCredit,
      walletType: "main",
      type: "funding",
      reference: generateTransactionReference("MLF"),
      provider: "maplerad",
      providerReference: finalProviderReference,
      narration: "Wallet funding via Maplerad one-time transfer",
      metadata: {
        ...payload,
        fee: feeResult.fee,
        grossAmount: intent.amount,
        amountPaid: paidAmountInMinorUnit || null,
        amountCredited: amountToCredit,
        feePaidBy: "platform",
      },
    });

    await createNotificationBestEffort({
      userId: intent.user,
      title: "Wallet funded successfully",
      message: `Your wallet has been credited with NGN ${fromMinorUnit(
        amountToCredit
      )}.`,
      type: "wallet_funding_success",
      channel: "both",
      priority: "normal",
      data: {
        provider: "maplerad",
        amount: fromMinorUnit(amountToCredit),
        grossAmount: fromMinorUnit(intent.amount),
        fee: fromMinorUnit(feeResult.fee),
        userReceivesFullAmount: true,
        reference: creditResult.transaction.reference,
        providerReference: finalProviderReference,
        paymentReference: intent.paymentReference,
      },
    });

    await processFirstDepositReferralRewardBestEffort({
      referredUserId: intent.user,
      qualifyingAmountInMinorUnit: intent.amount,
      fundingTransaction: creditResult.transaction,
      provider: "maplerad",
      providerReference: finalProviderReference,
    });

    intent.providerReference = finalProviderReference;
    intent.status = "paid";
    intent.paidAt = new Date();
    intent.fee = feeResult.fee;
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
