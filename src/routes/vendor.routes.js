import express from "express";
import {
  getVendorAirtimeNetworks,
  getVendorAirtimePurchase,
  getVendorCableTvPackages,
  getVendorCableTvProviders,
  getVendorCableTvPurchase,
  getVendorDataPlans,
  getVendorDataPurchase,
  getVendorProfile,
  getVendorSocialGrowthOrder,
  getVendorSocialGrowthServices,
  getVendorTransaction,
  getVendorWallet,
  listVendorSocialGrowthOrders,
  listVendorTransactions,
  purchaseVendorAirtime,
  purchaseVendorCableTv,
  purchaseVendorData,
  purchaseVendorSocialGrowth,
  quoteVendorAirtime,
  quoteVendorCableTv,
  quoteVendorSocialGrowth,
  verifyVendorCableTvSmartcard,
} from "../controllers/vendor.controller.js";
import { protectVendorApi } from "../middlewares/auth.middleware.js";
import {
  authenticatedRateLimit,
  rateLimit,
} from "../middlewares/rateLimit.middleware.js";
import { enforceServicePurchaseRestriction } from "../middlewares/servicePurchaseRestriction.middleware.js";

const router = express.Router();

router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    message: "Too many vendor API requests, please try again shortly",
    code: "RATE_LIMITED",
  })
);
router.use(protectVendorApi);
router.use(
  authenticatedRateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: "Too many vendor API requests, please try again shortly",
    code: "RATE_LIMITED",
  })
);

const vendorQuoteLimiter = authenticatedRateLimit({
  windowMs: 15 * 1000,
  max: 1,
  message: "Another vendor quote request was just submitted, please wait a moment",
  code: "RATE_LIMITED",
});

const vendorPurchaseLimiter = authenticatedRateLimit({
  windowMs: 15 * 1000,
  max: 1,
  message: "Another vendor purchase request was just submitted, please wait a moment",
  code: "RATE_LIMITED",
});

router.get("/me", getVendorProfile);
router.get("/wallet", getVendorWallet);
router.get("/transactions", listVendorTransactions);
router.get("/transactions/:reference", getVendorTransaction);

router.get("/data/plans", getVendorDataPlans);
router.post(
  "/data/purchase",
  enforceServicePurchaseRestriction,
  vendorPurchaseLimiter,
  purchaseVendorData
);
router.get("/data/purchase/:reference", getVendorDataPurchase);

router.get("/airtime/networks", getVendorAirtimeNetworks);
router.post("/airtime/quote", vendorQuoteLimiter, quoteVendorAirtime);
router.post(
  "/airtime/purchase",
  enforceServicePurchaseRestriction,
  vendorPurchaseLimiter,
  purchaseVendorAirtime
);
router.get("/airtime/purchase/:reference", getVendorAirtimePurchase);

router.get("/cable-tv/providers", getVendorCableTvProviders);
router.get("/cable-tv/packages", getVendorCableTvPackages);
router.post("/cable-tv/verify-smartcard", verifyVendorCableTvSmartcard);
router.post("/cable-tv/quote", vendorQuoteLimiter, quoteVendorCableTv);
router.post(
  "/cable-tv/purchase",
  enforceServicePurchaseRestriction,
  vendorPurchaseLimiter,
  purchaseVendorCableTv
);
router.get("/cable-tv/purchase/:reference", getVendorCableTvPurchase);

router.get("/social-growth/services", getVendorSocialGrowthServices);
router.post("/social-growth/quote", vendorQuoteLimiter, quoteVendorSocialGrowth);
router.post(
  "/social-growth/orders",
  enforceServicePurchaseRestriction,
  vendorPurchaseLimiter,
  purchaseVendorSocialGrowth
);
router.get("/social-growth/orders", listVendorSocialGrowthOrders);
router.get("/social-growth/orders/:orderId", getVendorSocialGrowthOrder);

export default router;
