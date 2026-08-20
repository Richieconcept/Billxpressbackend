import express from "express";
import {
  confirmFundingIntent,
  createBankTransfer,
  previewBankTransfer,
  createFundingIntent,
  previewFundingFee,
  createVirtualAccount,
  adminCreditReferralBalance,
  getTransactions,
  getTransferBankList,
  getVirtualAccount,
  getWallet,
  redeemReferralBalance,
  resolveTransferAccount,
  suggestTransferBankList,
} from "../controllers/wallet.controller.js";
import {
  authorizeRoles,
  protect,
  requireAuthTier,
  requireVerifiedEmail,
} from "../middlewares/auth.middleware.js";
import { authenticatedRateLimit } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();
const fundingLimiter = authenticatedRateLimit({
  windowMs: 15 * 1000,
  max: 1,
  message: "Another funding request was just submitted, please wait a moment",
});
const transferLookupLimiter = authenticatedRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many transfer lookup requests, please try again shortly",
});
const transferLimiter = authenticatedRateLimit({
  windowMs: 15 * 1000,
  max: 1,
  message: "Another transfer request was just submitted, please wait a moment",
});

router.get("/", protect, getWallet);
router.get("/transactions", protect, getTransactions);
router.get("/virtual-account", protect, getVirtualAccount);
router.post("/virtual-account", protect, fundingLimiter, createVirtualAccount);
router.post("/funding-intents", protect, fundingLimiter, createFundingIntent);
router.post("/funding/quote", protect, fundingLimiter, previewFundingFee);
router.post(
  "/funding-intents/:fundingIntentId/confirm",
  protect,
  fundingLimiter,
  confirmFundingIntent
);
router.get("/transfers/banks", protect, getTransferBankList);
router.post(
  "/transfers/suggest-banks",
  protect,
  transferLookupLimiter,
  suggestTransferBankList
);
router.post(
  "/transfers/resolve-account",
  protect,
  transferLookupLimiter,
  resolveTransferAccount
);
router.post("/transfers/quote", protect, transferLimiter, previewBankTransfer);
router.post(
  "/transfers",
  protect,
  transferLimiter,
  requireVerifiedEmail,
  requireAuthTier("tier_3"),
  createBankTransfer
);
router.post("/referral/redeem", protect, transferLimiter, redeemReferralBalance);
router.post(
  "/admin/referral-credit",
  protect,
  authorizeRoles("admin"),
  adminCreditReferralBalance
);

export default router;
