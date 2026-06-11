import express from "express";
import {
  getVendorAirtimeNetworks,
  getVendorAirtimePurchase,
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
  purchaseVendorData,
  purchaseVendorSocialGrowth,
  quoteVendorAirtime,
  quoteVendorSocialGrowth,
} from "../controllers/vendor.controller.js";
import { protectVendorApi } from "../middlewares/auth.middleware.js";
import { rateLimit } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: "Too many vendor API requests, please try again shortly",
    code: "RATE_LIMITED",
  })
);
router.use(protectVendorApi);

router.get("/me", getVendorProfile);
router.get("/wallet", getVendorWallet);
router.get("/transactions", listVendorTransactions);
router.get("/transactions/:reference", getVendorTransaction);

router.get("/data/plans", getVendorDataPlans);
router.post("/data/purchase", purchaseVendorData);
router.get("/data/purchase/:reference", getVendorDataPurchase);

router.get("/airtime/networks", getVendorAirtimeNetworks);
router.post("/airtime/quote", quoteVendorAirtime);
router.post("/airtime/purchase", purchaseVendorAirtime);
router.get("/airtime/purchase/:reference", getVendorAirtimePurchase);

router.get("/social-growth/services", getVendorSocialGrowthServices);
router.post("/social-growth/quote", quoteVendorSocialGrowth);
router.post("/social-growth/orders", purchaseVendorSocialGrowth);
router.get("/social-growth/orders", listVendorSocialGrowthOrders);
router.get("/social-growth/orders/:orderId", getVendorSocialGrowthOrder);

export default router;
