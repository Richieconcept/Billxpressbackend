import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import Wallet from "../models/wallet.model.js";
import Transaction from "../models/transaction.model.js";
import { getOrCreateWallet, serializeWallet } from "../services/wallet.service.js";
import { sanitizeUser } from "../utils/sanitizeUser.js";

const ADMIN_USER_UPDATE_FIELDS = [
  "firstName",
  "lastName",
  "username",
  "email",
  "phone",
  "isActive",
  "emailVerified",
  "authTier",
  "kycLevel",
];

const sendAdminUserError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : undefined;

const normalizeEmail = (value) => normalizeString(value)?.toLowerCase();
const normalizeUsername = (value) => normalizeString(value)?.toLowerCase();

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validatePhone = (phone) => /^0\d{10}$/.test(phone);

const generateReferralCode = (username) => {
  const random = Math.floor(1000 + Math.random() * 9000);
  return username.slice(0, 3).toUpperCase() + random;
};

const generateUniqueReferralCode = async (username) => {
  let referralCode = generateReferralCode(username);

  while (await User.exists({ referralCode })) {
    referralCode = generateReferralCode(username);
  }

  return referralCode;
};

const ensureUniqueUserField = async ({ field, value, excludeUserId }) => {
  if (!value) {
    return;
  }

  const existingUser = await User.findOne({
    [field]: value,
    ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}),
  });

  if (existingUser) {
    const error = new Error(`${field} already exists`);
    error.statusCode = 400;
    throw error;
  }
};

const getUserQuery = (req) => {
  const query = {};
  const search = normalizeString(req.query.search);

  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [
      { firstName: regex },
      { lastName: regex },
      { username: regex },
      { email: regex },
      { phone: regex },
    ];
  }

  if (req.query.role) {
    query.role = req.query.role;
  }

  if (req.query.authTier) {
    query.authTier = req.query.authTier;
  }

  if (req.query.status === "active") {
    query.isActive = true;
  }

  if (req.query.status === "inactive") {
    query.isActive = false;
  }

  return query;
};

export const listUsers = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const query = getUserQuery(req);
    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password -transactionPin -emailVerificationOtp")
        .lean()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(query),
    ]);
    const userIds = users.map((user) => user._id);
    const wallets = await Wallet.find({ user: { $in: userIds } }).lean();
    const walletsByUserId = new Map(
      wallets.map((wallet) => [String(wallet.user), wallet])
    );

    res.json({
      users: users.map((user) => {
        const wallet = walletsByUserId.get(String(user._id));

        return {
          ...sanitizeUser(user),
          wallet: wallet ? serializeWallet(wallet) : null,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendAdminUserError(res, "Could not fetch users", error);
  }
};

export const createUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      username,
      email,
      phone,
      password,
      transactionPin,
      authTier = "tier_1",
      kycLevel = 0,
      emailVerified = false,
      isActive = true,
      referredBy,
    } = req.body;

    const normalizedFirstName = normalizeString(firstName);
    const normalizedLastName = normalizeString(lastName);
    const normalizedUsername = normalizeUsername(username);
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizeString(phone);

    if (
      !normalizedFirstName ||
      !normalizedLastName ||
      !normalizedUsername ||
      !normalizedEmail ||
      !normalizedPhone ||
      !password ||
      !transactionPin
    ) {
      return res.status(400).json({
        message:
          "firstName, lastName, username, email, phone, password, and transactionPin are required",
      });
    }

    if (!validateEmail(normalizedEmail)) {
      return res.status(400).json({
        message: "Please provide a valid email address",
      });
    }

    if (!validatePhone(normalizedPhone)) {
      return res.status(400).json({
        message: "Phone number must be 11 digits and start with 0",
      });
    }

    if (password.length < 5) {
      return res.status(400).json({
        message: "Password must be at least 5 characters",
      });
    }

    if (!/^\d{4}$/.test(transactionPin)) {
      return res.status(400).json({
        message: "Transaction PIN must be 4 digits",
      });
    }

    await ensureUniqueUserField({ field: "email", value: normalizedEmail });
    await ensureUniqueUserField({ field: "phone", value: normalizedPhone });
    await ensureUniqueUserField({ field: "username", value: normalizedUsername });

    const user = await User.create({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      username: normalizedUsername,
      email: normalizedEmail,
      phone: normalizedPhone,
      password: await bcrypt.hash(password, 10),
      transactionPin: await bcrypt.hash(transactionPin, 10),
      referralCode: await generateUniqueReferralCode(normalizedUsername),
      referredBy: referredBy?.trim().toUpperCase() || null,
      role: "user",
      authTier,
      kycLevel,
      emailVerified,
      isActive,
    });

    await getOrCreateWallet(user._id);

    res.status(201).json({
      message: "User created successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendAdminUserError(res, "Could not create user", error);
  }
};

export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      "-password -transactionPin -emailVerificationOtp"
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const [wallet, transactionCount] = await Promise.all([
      Wallet.findOne({ user: user._id }),
      Transaction.countDocuments({ user: user._id }),
    ]);

    res.json({
      user: sanitizeUser(user),
      wallet: wallet ? serializeWallet(wallet) : null,
      transactionCount,
    });
  } catch (error) {
    sendAdminUserError(res, "Could not fetch user", error);
  }
};

export const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    for (const field of ADMIN_USER_UPDATE_FIELDS) {
      if (req.body[field] === undefined) {
        continue;
      }

      let value = req.body[field];

      if (["firstName", "lastName", "phone"].includes(field)) {
        value = normalizeString(value);
      }

      if (field === "username") {
        value = normalizeUsername(value);
      }

      if (field === "email") {
        value = normalizeEmail(value);
      }

      if (["firstName", "lastName", "username", "email", "phone"].includes(field) && !value) {
        return res.status(400).json({
          message: `${field} cannot be empty`,
        });
      }

      if (field === "email") {
        if (!validateEmail(value)) {
          return res.status(400).json({
            message: "Please provide a valid email address",
          });
        }
        await ensureUniqueUserField({
          field: "email",
          value,
          excludeUserId: user._id,
        });
      }

      if (field === "phone") {
        if (!validatePhone(value)) {
          return res.status(400).json({
            message: "Phone number must be 11 digits and start with 0",
          });
        }
        await ensureUniqueUserField({
          field: "phone",
          value,
          excludeUserId: user._id,
        });
      }

      if (field === "username") {
        await ensureUniqueUserField({
          field: "username",
          value,
          excludeUserId: user._id,
        });
      }

      user[field] = value;
    }

    await user.save();

    res.json({
      message: "User updated successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendAdminUserError(res, "Could not update user", error);
  }
};

export const setUserStatus = async (req, res) => {
  try {
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        message: "isActive must be true or false",
      });
    }

    if (String(req.params.userId) === String(req.user._id) && isActive === false) {
      return res.status(400).json({
        message: "Admins cannot deactivate their own account here",
      });
    }

    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (user.role === "admin" && user.isActive && isActive === false) {
      const activeAdminCount = await User.countDocuments({
        role: "admin",
        isActive: true,
      });

      if (activeAdminCount <= 1) {
        return res.status(400).json({
          message: "At least one active admin must remain",
        });
      }
    }

    user.isActive = isActive;
    await user.save();

    res.json({
      message: isActive ? "User activated successfully" : "User suspended successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendAdminUserError(res, "Could not update user status", error);
  }
};

export const deleteUser = async (req, res) => {
  try {
    if (String(req.params.userId) === String(req.user._id)) {
      return res.status(400).json({
        message: "Admins cannot delete their own account here",
      });
    }

    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (user.role === "admin" && user.isActive) {
      const activeAdminCount = await User.countDocuments({
        role: "admin",
        isActive: true,
      });

      if (activeAdminCount <= 1) {
        return res.status(400).json({
          message: "At least one active admin must remain",
        });
      }
    }

    user.isActive = false;
    await user.save();

    res.json({
      message: "User deleted successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendAdminUserError(res, "Could not delete user", error);
  }
};
