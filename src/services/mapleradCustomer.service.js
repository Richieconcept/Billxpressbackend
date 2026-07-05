import crypto from "crypto";
import MapleradCustomer from "../models/mapleradCustomer.model.js";
import User from "../models/user.model.js";
import {
  createMapleradCustomer,
  createMapleradVirtualAccount,
  upgradeMapleradCustomerTier1,
} from "./maplerad.service.js";
import {
  addMapleradVirtualAccountForUser,
} from "./virtualAccount.service.js";
import {
  creditWallet,
  debitWallet,
  fromMinorUnit,
  generateTransactionReference,
} from "./wallet.service.js";

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : undefined;

const TIER1_RETRY_COOLDOWN_MS = 15 * 60 * 1000;
const TIER1_PROCESSING_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_BVN_VERIFICATION_FEE = 100;

export const getBvnVerificationFeeInMinorUnit = () => {
  const configuredFee = Number(
    process.env.MAPLERAD_BVN_VERIFICATION_FEE ||
      DEFAULT_BVN_VERIFICATION_FEE
  );
  const fee =
    Number.isFinite(configuredFee) && configuredFee > 0
      ? configuredFee
      : DEFAULT_BVN_VERIFICATION_FEE;

  return Math.round(fee * 100);
};

const validateBvn = (value) => {
  const bvn = String(value || "").replace(/\s/g, "");

  if (!/^\d{11}$/.test(bvn)) {
    const error = new Error("BVN must contain exactly 11 digits");
    error.statusCode = 400;
    throw error;
  }

  return bvn;
};

const validateDateOfBirth = (value) => {
  const dob = normalizeString(value);
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dob || "");

  if (!match) {
    const error = new Error("Date of birth must use DD-MM-YYYY format");
    error.statusCode = 400;
    throw error;
  }

  const [, day, month, year] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCFullYear() !== Number(year) ||
    parsed >= new Date()
  ) {
    const error = new Error("A valid date of birth is required");
    error.statusCode = 400;
    throw error;
  }

  return dob;
};

const normalizePhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");

  if (/^0\d{10}$/.test(digits)) {
    return {
      phone_country_code: "+234",
      phone_number: digits.slice(1),
    };
  }

  if (/^234\d{10}$/.test(digits)) {
    return {
      phone_country_code: "+234",
      phone_number: digits.slice(3),
    };
  }

  if (/^\d{10}$/.test(digits)) {
    return {
      phone_country_code: "+234",
      phone_number: digits,
    };
  }

  return null;
};

const requireString = (payload, field, label = field) => {
  const value = normalizeString(payload?.[field]);

  if (!value) {
    const error = new Error(`${label} is required`);
    error.statusCode = 400;
    throw error;
  }

  return value;
};

const buildTier1Payload = (user, body) => {
  const address = body?.address || {};
  const phone =
    body?.phone?.phone_country_code && body?.phone?.phone_number
      ? {
          phone_country_code: normalizeString(body.phone.phone_country_code),
          phone_number: normalizeString(body.phone.phone_number),
        }
      : normalizePhone(body?.phoneNumber || user.phone);

  if (!phone?.phone_country_code || !phone?.phone_number) {
    const error = new Error("Valid phone number is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    dob: validateDateOfBirth(body?.dob),
    identification_number: validateBvn(
      normalizeString(body?.identificationNumber) ||
        requireString(body, "identification_number", "BVN")
    ),
    phone,
    address: {
      street: requireString(address, "street", "Address street"),
      street2: normalizeString(address.street2) || null,
      city: requireString(address, "city", "Address city"),
      state: requireString(address, "state", "Address state"),
      country: normalizeString(address.country) || "NG",
      postal_code:
        normalizeString(address.postalCode) ||
        requireString(address, "postal_code", "Address postal code"),
    },
    photo: normalizeString(body?.photo),
  };
};

const getTier1AttemptFingerprint = (payload) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

const reserveTier1Attempt = async (customer, fingerprint) => {
  const now = new Date();
  const processingCutoff = new Date(
    now.getTime() - TIER1_PROCESSING_TIMEOUT_MS
  );
  const cooldownCutoff = new Date(now.getTime() - TIER1_RETRY_COOLDOWN_MS);
  const current = await MapleradCustomer.findById(customer._id).select(
    "+tier1AttemptFingerprint"
  );

  if (
    current?.tier1AttemptStatus === "failed" &&
    current.tier1AttemptFingerprint === fingerprint &&
    current.tier1LastAttemptAt > cooldownCutoff
  ) {
    const error = new Error(
      `These same KYC details were recently rejected by Maplerad${
        current.tier1FailureReason ? `: ${current.tier1FailureReason}` : ""
      }. Confirm that the date of birth exactly matches the BVN record before retrying.`
    );
    error.statusCode = 429;
    throw error;
  }

  const reserved = await MapleradCustomer.findOneAndUpdate(
    {
      _id: customer._id,
      $or: [
        { tier1AttemptStatus: { $ne: "processing" } },
        { tier1LastAttemptAt: { $lte: processingCutoff } },
        { tier1LastAttemptAt: null },
      ],
    },
    {
      $set: {
        tier1AttemptStatus: "processing",
        tier1LastAttemptAt: now,
        tier1AttemptFingerprint: fingerprint,
        tier1FailureReason: null,
        tier1FeeTransaction: null,
        tier1FeeAmount: 0,
      },
    },
    { returnDocument: "after" }
  );

  if (!reserved) {
    const error = new Error("KYC verification is already in progress");
    error.statusCode = 409;
    throw error;
  }
};

export const serializeMapleradCustomer = (customer) =>
  customer
    ? {
        id: customer._id,
        customerId: customer.customerId,
        tier: customer.tier,
        status: customer.status,
        country: customer.country,
        tier1SubmittedAt: customer.tier1SubmittedAt,
        tier1ApprovedAt: customer.tier1ApprovedAt,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      }
    : null;

export const getMapleradCustomerForUser = (userId) =>
  MapleradCustomer.findOne({ user: userId });

export const getOrCreateMapleradCustomerForUser = async (user) => {
  const existingCustomer = await MapleradCustomer.findOne({ user: user._id });

  if (existingCustomer) {
    return existingCustomer;
  }

  const result = await createMapleradCustomer({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    country: "NG",
  });
  const customer = result.data || result;

  if (!customer.id) {
    const error = new Error("Maplerad did not return a customer ID");
    error.statusCode = 502;
    error.providerResponse = result;
    throw error;
  }

  return MapleradCustomer.create({
    user: user._id,
    customerId: customer.id,
    tier: Number(customer.tier) || 0,
    status: customer.status || "PENDING",
    country: customer.country || "NG",
    providerResponse: {
      createCustomer: result,
    },
  });
};

export const upgradeUserToMapleradTier1 = async (userId, body) => {
  const user = await User.findById(userId);

  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  if (!user.emailVerified) {
    const error = new Error("Please verify your email before upgrading KYC");
    error.statusCode = 403;
    throw error;
  }

  const customer = await getOrCreateMapleradCustomerForUser(user);

  if (customer.tier >= 1 || user.kycLevel >= 1) {
    const error = new Error("KYC verification has already been completed");
    error.statusCode = 409;
    throw error;
  }

  const tier1Payload = buildTier1Payload(user, body);
  const fingerprint = getTier1AttemptFingerprint(tier1Payload);
  await reserveTier1Attempt(customer, fingerprint);

  const verificationFee = getBvnVerificationFeeInMinorUnit();
  let feeResult;

  try {
    feeResult = await debitWallet({
      userId: user._id,
      amountInMinorUnit: verificationFee,
      walletType: "main",
      type: "service_payment",
      reference: generateTransactionReference("BVNKYC"),
      provider: "maplerad",
      narration: "BVN verification fee",
      metadata: {
        service: "bvn_verification",
        mapleradCustomerId: customer.customerId,
        chargedOnlyOnSuccessfulVerification: true,
      },
    });

    await MapleradCustomer.findByIdAndUpdate(customer._id, {
      $set: {
        tier1FeeTransaction: feeResult.transaction._id,
        tier1FeeAmount: verificationFee,
      },
    });
  } catch (error) {
    await MapleradCustomer.findByIdAndUpdate(customer._id, {
      $set: {
        tier1AttemptStatus: "idle",
        tier1AttemptFingerprint: null,
        tier1FailureReason: null,
        tier1FeeTransaction: null,
        tier1FeeAmount: 0,
      },
    });
    throw error;
  }

  let upgradeResponse;

  try {
    upgradeResponse = await upgradeMapleradCustomerTier1({
      customerId: customer.customerId,
      ...tier1Payload,
    });
  } catch (error) {
    const refundResult = await creditWallet({
      userId: user._id,
      amountInMinorUnit: verificationFee,
      walletType: "main",
      type: "reversal",
      reference: `${feeResult.transaction.reference}_REV`,
      provider: "maplerad",
      narration: "Refund for unsuccessful BVN verification",
      metadata: {
        service: "bvn_verification",
        originalReference: feeResult.transaction.reference,
        mapleradCustomerId: customer.customerId,
        providerFailure: error.message,
      },
    });

    feeResult.transaction.status = "reversed";
    feeResult.transaction.metadata = {
      ...feeResult.transaction.metadata,
      refundReference: refundResult.transaction.reference,
      providerFailure: error.message,
    };
    await feeResult.transaction.save();

    await MapleradCustomer.findByIdAndUpdate(customer._id, {
      $set: {
        tier1AttemptStatus: "failed",
        tier1FailureReason: error.message,
        tier1FeeTransaction: feeResult.transaction._id,
        tier1FeeAmount: 0,
      },
    });
    throw error;
  }

  customer.tier = Math.max(customer.tier || 0, 1);
  customer.status = upgradeResponse.data?.status || customer.status || "COMPLETED";
  customer.tier1SubmittedAt = customer.tier1SubmittedAt || new Date();
  customer.tier1ApprovedAt = new Date();
  customer.tier1AttemptStatus = "successful";
  customer.tier1FailureReason = null;
  customer.providerResponse = {
    ...customer.providerResponse,
    tier1Upgrade: upgradeResponse,
  };
  await customer.save();

  user.authTier = "tier_3";
  user.kycLevel = Math.max(Number(user.kycLevel) || 0, 1);
  await user.save();

  const accountResult = await createMapleradVirtualAccount({
    customerId: customer.customerId,
    currency: "NGN",
  });
  const virtualAccount = await addMapleradVirtualAccountForUser({
    user,
    account: accountResult.account,
    providerResponse: accountResult.providerResponse,
  });

  return {
    user,
    customer,
    virtualAccount,
  };
};

export const getMapleradKycStatusForUser = async (userId) => {
  const customer = await getMapleradCustomerForUser(userId);

  return {
    customer,
    settings: {
      bvnVerificationFee: fromMinorUnit(
        getBvnVerificationFeeInMinorUnit()
      ),
      currency: "NGN",
    },
  };
};
