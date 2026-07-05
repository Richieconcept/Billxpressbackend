import crypto from "crypto";
import FundingIntent from "../models/fundingIntent.model.js";
import CardQuote from "../models/cardQuote.model.js";
import Transaction from "../models/transaction.model.js";
import VirtualAccount from "../models/virtualAccount.model.js";
import VirtualDollarCard from "../models/virtualDollarCard.model.js";
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
import { verifyMapleradTransaction } from "../services/maplerad.service.js";

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

const mapleradWebhookAmountToMinorUnit = (amount) => {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return 0;
  }

  if (Number.isInteger(numericAmount)) {
    return numericAmount;
  }

  return Math.round(numericAmount * 100);
};

const processMapleradCardWebhook = async ({
  payload,
  event,
  webhookEvent,
}) => {
  const providerCard = payload.card || payload.data?.card || payload.data || {};
  const creationReference = pickFirst(
    payload.reference,
    payload.data?.reference
  );
  const providerCardId = pickFirst(
    providerCard.id,
    payload.card_id,
    payload.data?.card_id
  );
  const card = await VirtualDollarCard.findOne({
    $or: [
      ...(creationReference ? [{ creationReference }] : []),
      ...(providerCardId ? [{ providerCardId }] : []),
    ],
  });

  if (!card) {
    throw new Error("Could not match webhook to a virtual dollar card");
  }

  if (event === "issuing.created.successful") {
    card.providerCardId = providerCardId;
    card.status =
      String(providerCard.status || "ACTIVE").toUpperCase() === "DISABLED"
        ? "FROZEN"
        : "ACTIVE";
    card.name = providerCard.name || card.name;
    card.maskedPan = providerCard.masked_pan || card.maskedPan;
    card.balance = Number(providerCard.balance) || 0;
    if (!card.nextMaintenanceAt) {
      const nextMaintenanceAt = new Date();
      nextMaintenanceAt.setUTCMonth(nextMaintenanceAt.getUTCMonth() + 1);
      card.nextMaintenanceAt = nextMaintenanceAt;
    }
    card.providerResponse = payload;
    await card.save();
  } else if (event === "issuing.created.failed") {
    if (card.status !== "FAILED") {
      const quote = await CardQuote.findOne({
        card: card._id,
        operation: "creation",
      });
      const refundProviderReference = `card-creation-failed:${creationReference}`;
      const existingRefund = await Transaction.findOne({
        provider: "maplerad",
        providerReference: refundProviderReference,
      });

      if (quote && !existingRefund) {
        await creditWallet({
          userId: card.user,
          amountInMinorUnit: quote.walletDebit,
          walletType: "main",
          type: "reversal",
          reference: generateTransactionReference("VCR"),
          provider: "maplerad",
          providerReference: refundProviderReference,
          narration: "Refund for failed virtual dollar card creation",
          metadata: {
            service: "virtual_dollar_card",
            operation: "creation_refund",
            quoteId: quote._id,
            creationReference,
          },
        });
        quote.status = "failed";
        quote.failureReason = "Maplerad card creation failed";
        await quote.save();
      }

      card.status = "FAILED";
      card.providerResponse = payload;
      await card.save();
    }
  } else if (event === "issuing.terminated") {
    card.status = "TERMINATED";
    card.balance = 0;
    card.providerResponse = payload;
    await card.save();
  } else if (event === "issuing.transaction") {
    card.providerResponse = {
      ...card.providerResponse,
      latestTransaction: payload,
    };
    await card.save();
  }

  webhookEvent.processed = true;
  await webhookEvent.save();

  return {
    message: "Card webhook processed successfully",
  };
};

const creditMapleradDedicatedAccountFunding = async ({
  payload,
  accountId,
  accountNumber,
  amount,
  providerReference,
  paymentReference,
  webhookEvent,
}) => {
  const matchConditions = [
    ...(accountNumber ? [{ accountNumber: String(accountNumber) }] : []),
    ...(accountNumber
      ? [{ "accounts.accountNumber": String(accountNumber) }]
      : []),
    ...(accountId ? [{ "accounts.providerAccountId": String(accountId) }] : []),
  ];

  if (matchConditions.length === 0) {
    throw new Error("Webhook payload is missing account details");
  }

  const virtualAccount = await VirtualAccount.findOne({
    provider: "maplerad",
    $or: matchConditions,
  });

  if (!virtualAccount) {
    throw new Error("Could not match webhook to a Maplerad virtual account");
  }

  const finalProviderReference =
    providerReference || paymentReference || `${accountId || accountNumber}_${amount}`;
  const existingTransaction = await Transaction.findOne({
    provider: "maplerad",
    providerReference: finalProviderReference,
  });

  if (existingTransaction) {
    webhookEvent.processed = true;
    await webhookEvent.save();

    return {
      message: "Webhook already processed",
    };
  }

  const amountInMinorUnit = mapleradWebhookAmountToMinorUnit(amount);

  if (amountInMinorUnit <= 0) {
    throw new Error("Webhook payload is missing funding amount");
  }

  const feeResult = await calculateFundingFee(amountInMinorUnit, "maplerad");
  const creditResult = await creditWallet({
    userId: virtualAccount.user,
    amountInMinorUnit: feeResult.amountToReceive,
    walletType: "main",
    type: "funding",
    reference: generateTransactionReference("MLA"),
    provider: "maplerad",
    providerReference: finalProviderReference,
    narration: "Wallet funding via Maplerad dedicated account",
    metadata: {
      ...payload,
      accountId,
      accountNumber,
      fee: feeResult.fee,
      grossAmount: amountInMinorUnit,
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
      provider: "maplerad",
      fundingType: "dedicated_account",
      amount: fromMinorUnit(feeResult.amountToReceive),
      grossAmount: fromMinorUnit(amountInMinorUnit),
      fee: fromMinorUnit(feeResult.fee),
      userReceivesFullAmount: true,
      reference: creditResult.transaction.reference,
      providerReference: finalProviderReference,
      accountNumber,
    },
  });

  await processFirstDepositReferralRewardBestEffort({
    referredUserId: virtualAccount.user,
    qualifyingAmountInMinorUnit: amountInMinorUnit,
    fundingTransaction: creditResult.transaction,
    provider: "maplerad",
    providerReference: finalProviderReference,
  });

  webhookEvent.processed = true;
  await webhookEvent.save();

  return {
    message: "Webhook processed successfully",
  };
};

const finalizeMapleradTransferWebhook = async ({
  payload,
  event,
  providerReference,
  paymentReference,
  webhookEvent,
}) => {
  const finalProviderReference = providerReference || paymentReference;

  if (!finalProviderReference) {
    throw new Error("Webhook payload is missing transfer reference");
  }

  const transaction = await Transaction.findOne({
    provider: "maplerad",
    type: "transfer",
    $or: [
      { providerReference: finalProviderReference },
      { reference: finalProviderReference },
    ],
  });

  if (!transaction) {
    throw new Error("Could not match webhook to a Maplerad transfer");
  }

  if (transaction.status === "successful" || transaction.status === "reversed") {
    webhookEvent.processed = true;
    await webhookEvent.save();

    return {
      message: "Webhook already processed",
    };
  }

  if (event === "transfer.successful") {
    transaction.status = "successful";
    transaction.metadata = {
      ...transaction.metadata,
      transferWebhook: payload,
    };
    await transaction.save();
    webhookEvent.processed = true;
    await webhookEvent.save();

    await createNotificationBestEffort({
      userId: transaction.user,
      title: "Transfer successful",
      message: "Your bank transfer was successful.",
      type: "bank_transfer_success",
      channel: "both",
      priority: "normal",
      data: {
        reference: transaction.reference,
        providerReference: transaction.providerReference,
      },
    });

    return {
      message: "Transfer marked successful",
    };
  }

  if (event === "transfer.failed") {
    transaction.status = "reversed";
    transaction.metadata = {
      ...transaction.metadata,
      transferWebhook: payload,
    };
    await transaction.save();

    const refundResult = await creditWallet({
      userId: transaction.user,
      amountInMinorUnit: transaction.amount,
      walletType: transaction.walletType,
      type: "reversal",
      reference: `${transaction.reference}_REV`,
      provider: "maplerad",
      narration: "Refund for failed bank transfer",
      metadata: {
        service: "bank_transfer",
        originalReference: transaction.reference,
        providerReference: transaction.providerReference,
        transferWebhook: payload,
      },
    });

    webhookEvent.processed = true;
    await webhookEvent.save();

    await createNotificationBestEffort({
      userId: transaction.user,
      title: "Transfer failed",
      message: "Your bank transfer failed and has been refunded.",
      type: "bank_transfer_failed",
      channel: "both",
      priority: "normal",
      data: {
        reference: transaction.reference,
        refundReference: refundResult.transaction.reference,
        providerReference: transaction.providerReference,
      },
    });

    return {
      message: "Transfer refunded",
    };
  }

  throw new Error("Unsupported transfer webhook event");
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
  const initialFundingDetails = extractMapleradFundingDetails(payload);
  const webhookEvent = await WebhookEvent.create({
    provider: "maplerad",
    signature,
    eventReference:
      initialFundingDetails.providerReference ||
      initialFundingDetails.paymentReference ||
      initialFundingDetails.accountId,
    payload,
  });

  try {
    let fundingDetails = initialFundingDetails;

    if (
      fundingDetails.event === "collection.successful" &&
      fundingDetails.providerReference &&
      !fundingDetails.accountId &&
      !fundingDetails.accountNumber
    ) {
      const verification = await verifyMapleradTransaction(
        fundingDetails.providerReference
      );
      fundingDetails = extractMapleradFundingDetails({
        ...payload,
        data: verification.data || verification,
      });
    }

    const {
      event,
      status,
      providerReference,
      paymentReference,
      accountId,
      accountNumber,
      amount,
    } = fundingDetails;

    if (
      event &&
      ![
        "collection.successful",
        "account.transaction",
        "transfer.successful",
        "transfer.failed",
        "issuing.created.successful",
        "issuing.created.failed",
        "issuing.transaction",
        "issuing.terminated",
      ].includes(event)
    ) {
      webhookEvent.processed = true;
      await webhookEvent.save();

      return res.json({
        message: "Webhook ignored",
      });
    }

    if (event.startsWith("issuing.")) {
      const result = await processMapleradCardWebhook({
        payload,
        event,
        webhookEvent,
      });

      return res.json(result);
    }

    if (["transfer.successful", "transfer.failed"].includes(event)) {
      const result = await finalizeMapleradTransferWebhook({
        payload,
        event,
        providerReference,
        paymentReference,
        webhookEvent,
      });

      return res.json(result);
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
      if (event === "account.transaction") {
        const result = await creditMapleradDedicatedAccountFunding({
          payload,
          accountId,
          accountNumber,
          amount,
          providerReference,
          paymentReference,
          webhookEvent,
        });

        return res.json(result);
      }

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
