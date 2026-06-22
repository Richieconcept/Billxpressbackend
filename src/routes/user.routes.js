import express from "express";
import {
  changeMyPassword,
  deactivateMyAccount,
  getMyKycStatus,
  getMyProfile,
  requestTransactionPinResetCode,
  resetMyTransactionPin,
  updateMyProfile,
  upgradeMyMapleradTier1,
} from "../controllers/user.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { rateLimit } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

const transactionPinResetCodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: "Too many transaction PIN reset code requests, please try again later",
});

const transactionPinResetLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: "Too many transaction PIN reset attempts, please try again later",
});

router.use(protect);

router.get("/me", getMyProfile);
router.get("/me/kyc", getMyKycStatus);
router.post("/me/kyc/maplerad-tier1", upgradeMyMapleradTier1);
router.patch("/me", updateMyProfile);
router.patch("/me/password", changeMyPassword);
router.post(
  "/me/transaction-pin/reset-code",
  transactionPinResetCodeLimiter,
  requestTransactionPinResetCode
);
router.patch(
  "/me/transaction-pin/reset",
  transactionPinResetLimiter,
  resetMyTransactionPin
);
router.delete("/me", deactivateMyAccount);

export default router;
