import express from "express";
import {
  confirmFundingIntent,
  createBankTransfer,
  createFundingIntent,
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
} from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getWallet);
router.get("/transactions", protect, getTransactions);
router.get("/virtual-account", protect, getVirtualAccount);
router.post("/virtual-account", protect, createVirtualAccount);
router.post("/funding-intents", protect, createFundingIntent);
router.post("/funding-intents/:fundingIntentId/confirm", protect, confirmFundingIntent);
router.get("/transfers/banks", protect, getTransferBankList);
router.post("/transfers/suggest-banks", protect, suggestTransferBankList);
router.post("/transfers/resolve-account", protect, resolveTransferAccount);
router.post("/transfers", protect, requireAuthTier("tier_2"), createBankTransfer);
router.post("/referral/redeem", protect, redeemReferralBalance);
router.post(
  "/admin/referral-credit",
  protect,
  authorizeRoles("admin"),
  adminCreditReferralBalance
);

export default router;
