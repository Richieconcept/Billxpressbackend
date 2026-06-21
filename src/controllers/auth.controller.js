import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import {
  canResendEmailVerificationOtp,
  createEmailVerificationOtp,
  hashEmailVerificationOtp,
} from "../utils/emailVerification.js";
import {
  emailVerificationTemplate,
  passwordResetTemplate,
} from "../utils/emailTemplates.js";
import { generateToken } from "../utils/generateToken.js";
import { sanitizeUser } from "../utils/sanitizeUser.js";
import { sendEmail } from "../utils/sendEmail.js";
import {
  createAuthSession,
  revokeAuthSession,
  rotateAuthSession,
  serializeAuthSession,
} from "../services/authSession.service.js";
import { getOrCreateWallet } from "../services/wallet.service.js";
import {
  getOrCreateVirtualAccountForUser,
  serializeVirtualAccount,
} from "../services/virtualAccount.service.js";
import { createNotificationBestEffort } from "../services/notification.service.js";

const sendServerError = (res, publicMessage, error) => {
  console.error(publicMessage, error);

  return res.status(500).json({
    message: publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

// 🔑 Generate Referral Code
const generateReferralCode = (username) => {
  const random = Math.floor(1000 + Math.random() * 9000);
  return username.slice(0, 3).toUpperCase() + random;
};

const getRefreshTokenFromRequest = (req) =>
  req.body?.refreshToken || req.headers["x-refresh-token"];

const getDeviceNameFromRequest = (req) =>
  req.body?.deviceName || req.headers["x-device-name"];

const shouldNotifyOnLogin = () =>
  String(process.env.AUTH_LOGIN_NOTIFICATION_ENABLED || "true").toLowerCase() ===
  "true";

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

const buildAuthResponse = ({ message, user, token, refreshToken, session }) => ({
  message,
  token,
  accessToken: token,
  refreshToken,
  session: serializeAuthSession(session),
  user: sanitizeUser(user),
  mobileAuth: {
    pinUnlockSupported: true,
    biometricUnlockSupported: true,
    note:
      "PIN and biometric are verified on the mobile device. After local unlock, use refreshToken to get a fresh accessToken.",
  },
});

// ==========================
// REGISTER USER
// ==========================
export const registerUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      username,
      email,
      phone,
      password,
      confirmPassword,
      transactionPin,
      referredBy,
    } = req.body;

    const normalizedFirstName = firstName?.trim();
    const normalizedLastName = lastName?.trim();
    const normalizedUsername = username?.trim().toLowerCase();
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phone?.trim();
    const normalizedReferredBy = referredBy?.trim().toUpperCase() || null;

    // 1. Validate fields
    if (
      !normalizedFirstName ||
      !normalizedLastName ||
      !normalizedUsername ||
      !normalizedEmail ||
      !normalizedPhone ||
      !password ||
      !confirmPassword ||
      !transactionPin
    ) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        message: "Please provide a valid email address",
      });
    }

    if (!/^0\d{10}$/.test(normalizedPhone)) {
      return res.status(400).json({
        message: "Phone number must be 11 digits and start with 0",
      });
    }

    if (password.length < 5) {
      return res.status(400).json({
        message: "Password must be at least 5 characters",
      });
    }

    // 2. Password match
    if (password !== confirmPassword) {
      return res.status(400).json({
        message: "Passwords do not match",
      });
    }

    // 3. PIN validation
    if (!/^\d{4}$/.test(transactionPin)) {
      return res.status(400).json({
        message: "Transaction PIN must be 4 digits",
      });
    }

    // 4. Check existing user
    const existingUser = await User.findOne({
      $or: [
        { email: normalizedEmail },
        { phone: normalizedPhone },
        { username: normalizedUsername },
      ],
    });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    // 5. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 6. Hash PIN
    const hashedPin = await bcrypt.hash(transactionPin, 10);

    // 7. Generate referral code
    const referralCode = generateReferralCode(normalizedUsername);

    // 8. Create user
    const user = await User.create({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      username: normalizedUsername,
      email: normalizedEmail,
      phone: normalizedPhone,
      password: hashedPassword,
      transactionPin: hashedPin,
      referralCode,
      referredBy: normalizedReferredBy,
      emailVerified: false,
      authTier: "tier_1",
      kycLevel: 0,
    });

    await getOrCreateWallet(user._id);
    let virtualAccount = null;
    let virtualAccountCreated = false;
    let virtualAccountError = null;
    let virtualAccountErrors = [];

    try {
      const virtualAccountResult = await getOrCreateVirtualAccountForUser(user);
      virtualAccount = await serializeVirtualAccount(
        virtualAccountResult.virtualAccount
      );
      virtualAccountCreated = virtualAccountResult.created;
      virtualAccountErrors = virtualAccountResult.providerErrors || [];
    } catch (error) {
      virtualAccountError = error.message;
      virtualAccountErrors = error.providerErrors || [];
      console.error("Virtual account creation failed", error);
    }

    res.status(201).json({
      message: "Account created successfully",
      requiresVerification: false,
      user: sanitizeUser(user),
      virtualAccount,
      virtualAccounts: virtualAccount?.accounts || [],
      virtualAccountCreated,
      virtualAccountError,
      virtualAccountErrors,
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "field";

      return res.status(400).json({
        message: `${field} already exists`,
      });
    }

    return sendServerError(res, "Registration failed", error);
  }
};

// ==========================
// LOGIN USER
// ==========================
export const loginUser = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const rawIdentifier =
      typeof identifier === "string" ? identifier.trim() : "";
    const normalizedIdentifier = rawIdentifier.toLowerCase();

    // 1. Validate input
    if (!normalizedIdentifier || !password) {
      return res.status(400).json({
        message: "Identifier and password are required",
      });
    }

    // 2. Find user (username OR email OR phone)
    const user = await User.findOne({
      $or: [
        { email: normalizedIdentifier },
        { username: normalizedIdentifier },
        { phone: rawIdentifier },
      ],
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    // 3. Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    // 4. Generate JWT and mobile refresh session
    const token = generateToken(user);
    const sessionResult = await createAuthSession({
      user,
      deviceName: getDeviceNameFromRequest(req),
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });

    if (shouldNotifyOnLogin()) {
      await createNotificationBestEffort({
        userId: user._id,
        title: "New login to your BillXpress account",
        message:
          "Your BillXpress account was just logged in. If this was not you, please change your password immediately.",
        type: "security",
        channel: process.env.AUTH_LOGIN_NOTIFICATION_CHANNEL || "both",
        priority: "normal",
        data: {
          deviceName: getDeviceNameFromRequest(req) || null,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] || null,
        },
      });
    }

    // 5. Return response
    res.json(
      buildAuthResponse({
        message: "Login successful",
        user,
        token,
        refreshToken: sessionResult.refreshToken,
        session: sessionResult.session,
      })
    );
  } catch (error) {
    return sendServerError(res, "Login failed", error);
  }
};

export const refreshSession = async (req, res) => {
  try {
    const sessionResult = await rotateAuthSession(getRefreshTokenFromRequest(req));
    const token = generateToken(sessionResult.user);

    res.json(
      buildAuthResponse({
        message: "Session refreshed successfully",
        user: sessionResult.user,
        token,
        refreshToken: sessionResult.refreshToken,
        session: sessionResult.session,
      })
    );
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Could not refresh session",
      error: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
};

export const logoutUser = async (req, res) => {
  try {
    await revokeAuthSession(getRefreshTokenFromRequest(req));

    res.json({
      message: "Logged out successfully",
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Logout failed",
      error: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
};

export const requestPasswordResetCode = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();

    if (!normalizedEmail) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        message: "Please provide a valid email address",
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+passwordResetOtp +passwordResetOtpExpires +passwordResetOtpLastSentAt"
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const resendStatus = canResendEmailVerificationOtp(
      user.passwordResetOtpLastSentAt
    );

    if (!resendStatus.allowed) {
      return res.status(429).json({
        message: "Please wait before requesting another code",
        retryAfterSeconds: resendStatus.retryAfterSeconds,
      });
    }

    const previousOtp = user.passwordResetOtp;
    const previousOtpExpires = user.passwordResetOtpExpires;
    const previousOtpLastSentAt = user.passwordResetOtpLastSentAt;
    const verification = createEmailVerificationOtp();

    user.passwordResetOtp = verification.hashedOtp;
    user.passwordResetOtpExpires = verification.expires;
    user.passwordResetOtpLastSentAt = new Date();

    try {
      await user.save();
    } catch (error) {
      user.passwordResetOtp = previousOtp;
      user.passwordResetOtpExpires = previousOtpExpires;
      user.passwordResetOtpLastSentAt = previousOtpLastSentAt;
      throw error;
    }

    const template = passwordResetTemplate({
      username: user.username,
      otp: verification.otp,
    });

    try {
      await sendEmail({
        to: user.email,
        name: user.username,
        tags: ["password-reset"],
        ...template,
      });
    } catch (error) {
      user.passwordResetOtp = previousOtp;
      user.passwordResetOtpExpires = previousOtpExpires;
      user.passwordResetOtpLastSentAt = previousOtpLastSentAt;
      await user.save();
      throw error;
    }

    res.json({
      message: "Password reset code sent successfully",
      maskedEmail: maskEmail(user.email),
    });
  } catch (error) {
    return sendServerError(res, "Could not send password reset code", error);
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();
    const resetCode =
      req.body.resetCode || req.body.resetToken || req.body.code || req.body.otp;

    if (!normalizedEmail || !resetCode || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message: "Email, reset code, new password, and confirm password are required",
      });
    }

    if (!/^\d{5}$/.test(String(resetCode))) {
      return res.status(400).json({
        message: "Reset code must be 5 digits",
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

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+password +passwordResetOtp +passwordResetOtpExpires +passwordResetOtpLastSentAt"
    );

    if (!user) {
      return res.status(400).json({
        message: "Reset code is invalid or has expired",
      });
    }

    if (
      !user.passwordResetOtp ||
      !user.passwordResetOtpExpires ||
      user.passwordResetOtpExpires < Date.now()
    ) {
      return res.status(400).json({
        message: "Reset code is invalid or has expired",
      });
    }

    const hashedResetCode = hashEmailVerificationOtp(resetCode);

    if (hashedResetCode !== user.passwordResetOtp) {
      return res.status(400).json({
        message: "Reset code is invalid or has expired",
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetOtp = null;
    user.passwordResetOtpExpires = null;
    user.passwordResetOtpLastSentAt = null;
    await user.save();

    res.json({
      message: "Password reset successfully",
    });
  } catch (error) {
    return sendServerError(res, "Could not reset password", error);
  }
};

export const verifyEmailOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({
        message: "Email and OTP are required",
      });
    }

    if (!/^\d{5}$/.test(String(otp))) {
      return res.status(400).json({
        message: "OTP must be 5 digits",
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+emailVerificationOtp +emailVerificationOtpExpires"
    );

    if (!user) {
      return res.status(400).json({
        message: "Invalid verification details",
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        message: "Email is already verified",
      });
    }

    if (
      !user.emailVerificationOtp ||
      !user.emailVerificationOtpExpires ||
      user.emailVerificationOtpExpires < Date.now()
    ) {
      return res.status(400).json({
        message: "OTP is invalid or has expired",
      });
    }

    const hashedOtp = hashEmailVerificationOtp(otp);

    if (hashedOtp !== user.emailVerificationOtp) {
      return res.status(400).json({
        message: "OTP is invalid or has expired",
      });
    }

    user.emailVerified = true;
    user.kycLevel = Math.max(user.kycLevel || 0, 1);
    user.emailVerificationOtp = null;
    user.emailVerificationOtpExpires = null;
    user.emailVerificationOtpLastSentAt = null;
    await user.save();

    res.json({
      message: "Email verified successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    return sendServerError(res, "Email verification failed", error);
  }
};

export const resendEmailOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();

    if (!normalizedEmail) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+emailVerificationOtp +emailVerificationOtpExpires +emailVerificationOtpLastSentAt"
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        message: "Email is already verified",
      });
    }

    const resendStatus = canResendEmailVerificationOtp(user.emailVerificationOtpLastSentAt);

    if (!resendStatus.allowed) {
      return res.status(429).json({
        message: "Please wait before requesting another code",
        retryAfterSeconds: resendStatus.retryAfterSeconds,
      });
    }

    const previousOtp = user.emailVerificationOtp;
    const previousOtpExpires = user.emailVerificationOtpExpires;
    const previousOtpLastSentAt = user.emailVerificationOtpLastSentAt;
    const verification = createEmailVerificationOtp();
    user.emailVerificationOtp = verification.hashedOtp;
    user.emailVerificationOtpExpires = verification.expires;
    user.emailVerificationOtpLastSentAt = new Date();

    try {
      await user.save();
    } catch (error) {
      user.emailVerificationOtp = previousOtp;
      user.emailVerificationOtpExpires = previousOtpExpires;
      user.emailVerificationOtpLastSentAt = previousOtpLastSentAt;
      throw error;
    }

    const template = emailVerificationTemplate({
      username: user.username,
      otp: verification.otp,
    });

    try {
      await sendEmail({
        to: user.email,
        name: user.username,
        ...template,
      });
    } catch (error) {
      user.emailVerificationOtp = previousOtp;
      user.emailVerificationOtpExpires = previousOtpExpires;
      user.emailVerificationOtpLastSentAt = previousOtpLastSentAt;
      await user.save();
      throw error;
    }

    res.json({
      message: "Verification code sent successfully",
    });
  } catch (error) {
    return sendServerError(res, "Could not resend verification code", error);
  }
};

export const getMe = async (req, res) => {
  res.json({
    user: sanitizeUser(req.user),
  });
};
