import express from "express";
import {
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
  verifyEmailOtp,
  resendEmailOtp,
  requestPasswordResetCode,
  resetPassword,
  getMe,
} from "../controllers/auth.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { rateLimit } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyFields: ["email", "phone", "username"],
  message: "Too many registration attempts, please try again later",
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFields: ["identifier"],
  message: "Too many login attempts, please try again later",
});

const verifyEmailOtpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyFields: ["email"],
  message: "Too many verification attempts, please try again later",
});

const resendEmailOtpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyFields: ["email"],
  message: "Too many verification code requests, please try again later",
});

const passwordResetCodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyFields: ["email"],
  message: "Too many password reset code requests, please try again later",
});

const passwordResetLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyFields: ["email"],
  message: "Too many password reset attempts, please try again later",
});

router.post("/register", registerLimiter, registerUser);
router.post("/login", loginLimiter, loginUser);
router.post("/refresh-session", refreshSession);
router.post("/logout", logoutUser);
router.post("/forgot-password", passwordResetCodeLimiter, requestPasswordResetCode);
router.patch("/reset-password", passwordResetLimiter, resetPassword);
router.post("/verify-email-otp", verifyEmailOtpLimiter, verifyEmailOtp);
router.post("/resend-email-otp", resendEmailOtpLimiter, resendEmailOtp);
router.get("/me", protect, getMe);

export default router;
