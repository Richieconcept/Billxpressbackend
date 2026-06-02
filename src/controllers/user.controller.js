import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import { sanitizeUser } from "../utils/sanitizeUser.js";

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

export const changeMyTransactionPin = async (req, res) => {
  try {
    const { currentTransactionPin, newTransactionPin, confirmTransactionPin } =
      req.body;

    if (!currentTransactionPin || !newTransactionPin || !confirmTransactionPin) {
      return res.status(400).json({
        message:
          "Current transaction PIN, new transaction PIN, and confirm transaction PIN are required",
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

    const user = await User.findById(req.user._id).select("+transactionPin");
    const isMatch = await bcrypt.compare(
      currentTransactionPin,
      user.transactionPin
    );

    if (!isMatch) {
      return res.status(400).json({
        message: "Current transaction PIN is incorrect",
      });
    }

    user.transactionPin = await bcrypt.hash(newTransactionPin, 10);
    await user.save();

    res.json({
      message: "Transaction PIN changed successfully",
    });
  } catch (error) {
    sendUserError(res, "Could not change transaction PIN", error);
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
