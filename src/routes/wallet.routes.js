import express from "express";
import {
  confirmFundingIntent,
  createFundingIntent,
  createVirtualAccount,
  adminCreditReferralBalance,
  getTransactions,
  getVirtualAccount,
  getWallet,
  redeemReferralBalance,
} from "../controllers/wallet.controller.js";
import { authorizeRoles, protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getWallet);
router.get("/transactions", protect, getTransactions);
router.get("/virtual-account", protect, getVirtualAccount);
router.post("/virtual-account", protect, createVirtualAccount);
router.post("/funding-intents", protect, createFundingIntent);
router.post("/funding-intents/:fundingIntentId/confirm", protect, confirmFundingIntent);
router.post("/referral/redeem", protect, redeemReferralBalance);
router.post(
  "/admin/referral-credit",
  protect,
  authorizeRoles("admin"),
  adminCreditReferralBalance
);

export default router;
