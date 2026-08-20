import express from "express";
import {
  getSocialGrowthOrder,
  getSocialGrowthServices,
  listSocialGrowthOrders,
  purchaseSocialGrowth,
  quoteSocialGrowth,
} from "../controllers/socialGrowth.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { authenticatedRateLimit } from "../middlewares/rateLimit.middleware.js";
import { enforceServicePurchaseRestriction } from "../middlewares/servicePurchaseRestriction.middleware.js";

const router = express.Router();
const quoteLimiter = authenticatedRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many social growth quote requests, please try again shortly",
});
const purchaseLimiter = authenticatedRateLimit({
  windowMs: 15 * 1000,
  max: 1,
  message: "Another social growth order was just submitted, please wait a moment",
});

router.get("/social-growth/services", protect, getSocialGrowthServices);
router.post("/social-growth/quote", protect, quoteLimiter, quoteSocialGrowth);
router.post(
  "/social-growth/orders",
  protect,
  enforceServicePurchaseRestriction,
  purchaseLimiter,
  purchaseSocialGrowth
);
router.get("/social-growth/orders", protect, listSocialGrowthOrders);
router.get("/social-growth/orders/:orderId", protect, getSocialGrowthOrder);

export default router;
