import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import {
  canResendEmailVerificationOtp,
  createEmailVerificationOtp,
  hashEmailVerificationOtp,
} from "../utils/emailVerification.js";
import { transactionPinResetTemplate } from "../utils/emailTemplates.js";
import { sanitizeUser } from "../utils/sanitizeUser.js";
import { sendEmail } from "../utils/sendEmail.js";
import {
  getMapleradKycStatusForUser,
  serializeMapleradCustomer,
  upgradeUserToMapleradTier1,
} from "../services/mapleradCustomer.service.js";
import { serializeVirtualAccount } from "../services/virtualAccount.service.js";

const USER_EDITABLE_FIELDS = ["firstName", "lastName", "username", "phone"];

const sendUserError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : undefined;

const normalizeUsername = (value) => normalizeString(value)?.toLowerCase();

const validatePhone = (phone) => /^0\d{10}$/.test(phone);

const maskEmail = (email = "") => {
  const [localPart, domain] = String(email).split("@");

  if (!localPart || !domain) {
    return email;
  }

  const visibleStart = localPart.slice(0, 2);
  const visibleEnd = localPart.length > 4 ? localPart.slice(-2) : "";
  const hiddenLength = Math.max(
    localPart.length - visibleStart.length - visibleEnd.length,
    2
  );

  return `${visibleStart}${"*".repeat(hiddenLength)}${visibleEnd}@${domain}`;
};

const ensureUniqueUserField = async ({ field, value, excludeUserId }) => {
  if (!value) {
    return;
  }

  const existingUser = await User.findOne({
    [field]: value,
    _id: { $ne: excludeUserId },
  });

  if (existingUser) {
    const error = new Error(`${field} already exists`);
    error.statusCode = 400;
    throw error;
  }
};

export const getMyProfile = async (req, res) => {
  res.json({
    user: sanitizeUser(req.user),
  });
};

export const getMyKycStatus = async (req, res) => {
  try {
    const { customer } = await getMapleradKycStatusForUser(req.user._id);

    res.json({
      user: sanitizeUser(req.user),
      mapleradCustomer: serializeMapleradCustomer(customer),
    });
  } catch (error) {
    sendUserError(res, "Could not fetch KYC status", error);
  }
};

export const upgradeMyMapleradTier1 = async (req, res) => {
  try {
    const result = await upgradeUserToMapleradTier1(req.user._id, req.body);

    res.status(201).json({
      message: "Tier upgrade completed successfully",
      user: sanitizeUser(result.user),
      mapleradCustomer: serializeMapleradCustomer(result.customer),
      virtualAccount: await serializeVirtualAccount(result.virtualAccount),
    });
  } catch (error) {
    sendUserError(res, "Could not complete tier upgrade", error);
  }
};

export const updateMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    for (const field of USER_EDITABLE_FIELDS) {
      if (req.body[field] === undefined) {
        continue;
      }

      const value =
        field === "username"
          ? normalizeUsername(req.body[field])
          : normalizeString(req.body[field]);

      if (!value) {
        return res.status(400).json({
          message: `${field} cannot be empty`,
        });
      }

      if (field === "phone" && !validatePhone(value)) {
        return res.status(400).json({
          message: "Phone number must be 11 digits and start with 0",
        });
      }

      if (field === "username") {
        await ensureUniqueUserField({
          field: "username",
          value,
          excludeUserId: user._id,
        });
      }

      if (field === "phone") {
        await ensureUniqueUserField({
          field: "phone",
          value,
          excludeUserId: user._id,
        });
      }

      user[field] = value;
    }

    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendUserError(res, "Could not update profile", error);
  }
};

export const changeMyPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message: "Current password, new password, and confirm password are required",
      });
    }

    if (newPassword.length < 5) {
      return res.status(400).json({
        message: "New password must be at least 5 characters",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: "Passwords do not match",
      });
    }

    const user = await User.findById(req.user._id);
    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({
      message: "Password changed successfully",
    });
  } catch (error) {
    sendUserError(res, "Could not change password", error);
  }
};

export const requestTransactionPinResetCode = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "+transactionPinResetOtp +transactionPinResetOtpExpires +transactionPinResetOtpLastSentAt"
    );

    const resendStatus = canResendEmailVerificationOtp(
      user.transactionPinResetOtpLastSentAt
    );

    if (!resendStatus.allowed) {
      return res.status(429).json({
        message: "Please wait before requesting another code",
        retryAfterSeconds: resendStatus.retryAfterSeconds,
      });
    }

    const previousOtp = user.transactionPinResetOtp;
    const previousOtpExpires = user.transactionPinResetOtpExpires;
    const previousOtpLastSentAt = user.transactionPinResetOtpLastSentAt;
    const verification = createEmailVerificationOtp();

    user.transactionPinResetOtp = verification.hashedOtp;
    user.transactionPinResetOtpExpires = verification.expires;
    user.transactionPinResetOtpLastSentAt = new Date();

    try {
      await user.save();
    } catch (error) {
      user.transactionPinResetOtp = previousOtp;
      user.transactionPinResetOtpExpires = previousOtpExpires;
      user.transactionPinResetOtpLastSentAt = previousOtpLastSentAt;
      throw error;
    }

    const template = transactionPinResetTemplate({
      username: user.username,
      otp: verification.otp,
    });

    try {
      await sendEmail({
        to: user.email,
        name: user.username,
        tags: ["transaction-pin-reset"],
        ...template,
      });
    } catch (error) {
      user.transactionPinResetOtp = previousOtp;
      user.transactionPinResetOtpExpires = previousOtpExpires;
      user.transactionPinResetOtpLastSentAt = previousOtpLastSentAt;
      await user.save();
      throw error;
    }

    res.json({
      message: "Transaction PIN reset code sent successfully",
      maskedEmail: maskEmail(user.email),
    });
  } catch (error) {
    sendUserError(res, "Could not send transaction PIN reset code", error);
  }
};

export const resetMyTransactionPin = async (req, res) => {
  try {
    const resetCode =
      req.body.resetCode || req.body.resetToken || req.body.code || req.body.otp;
    const { newTransactionPin, confirmTransactionPin } = req.body;

    if (!resetCode || !newTransactionPin || !confirmTransactionPin) {
      return res.status(400).json({
        message:
          "Reset code, new transaction PIN, and confirm transaction PIN are required",
      });
    }

    if (!/^\d{5}$/.test(String(resetCode))) {
      return res.status(400).json({
        message: "Reset code must be 5 digits",
      });
    }

    if (!/^\d{4}$/.test(newTransactionPin)) {
      return res.status(400).json({
        message: "New transaction PIN must be 4 digits",
      });
    }

    if (newTransactionPin !== confirmTransactionPin) {
      return res.status(400).json({
        message: "Transaction PINs do not match",
      });
    }

    const user = await User.findById(req.user._id).select(
      "+transactionPin +transactionPinResetOtp +transactionPinResetOtpExpires +transactionPinResetOtpLastSentAt"
    );

    if (
      !user.transactionPinResetOtp ||
      !user.transactionPinResetOtpExpires ||
      user.transactionPinResetOtpExpires < Date.now()
    ) {
      return res.status(400).json({
        message: "Reset code is invalid or has expired",
      });
    }

    const hashedResetCode = hashEmailVerificationOtp(resetCode);

    if (hashedResetCode !== user.transactionPinResetOtp) {
      return res.status(400).json({
        message: "Reset code is invalid or has expired",
      });
    }

    user.transactionPin = await bcrypt.hash(newTransactionPin, 10);
    user.transactionPinResetOtp = null;
    user.transactionPinResetOtpExpires = null;
    user.transactionPinResetOtpLastSentAt = null;
    await user.save();

    res.json({
      message: "Transaction PIN reset successfully",
    });
  } catch (error) {
    sendUserError(res, "Could not reset transaction PIN", error);
  }
};

export const deactivateMyAccount = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        message: "Password is required",
      });
    }

    const user = await User.findById(req.user._id);
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Password is incorrect",
      });
    }

    user.isActive = false;
    await user.save();

    res.json({
      message: "Account deactivated successfully",
    });
  } catch (error) {
    sendUserError(res, "Could not deactivate account", error);
  }
};
