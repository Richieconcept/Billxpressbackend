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

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : undefined;

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
    dob: requireString(body, "dob", "Date of birth"),
    identification_number:
      normalizeString(body?.identificationNumber) ||
      requireString(body, "identification_number", "Identification number"),
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
  const tier1Payload = buildTier1Payload(user, body);
  const upgradeResponse = await upgradeMapleradCustomerTier1({
    customerId: customer.customerId,
    ...tier1Payload,
  });

  customer.tier = Math.max(customer.tier || 0, 1);
  customer.status = upgradeResponse.data?.status || customer.status || "COMPLETED";
  customer.tier1SubmittedAt = customer.tier1SubmittedAt || new Date();
  customer.tier1ApprovedAt = new Date();
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
  };
};
