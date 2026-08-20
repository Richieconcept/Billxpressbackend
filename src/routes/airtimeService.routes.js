import express from "express";
import {
  getAirtimeNetworks,
  purchaseAirtime,
  quoteAirtime,
} from "../controllers/airtimeService.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { authenticatedRateLimit } from "../middlewares/rateLimit.middleware.js";
import { enforceServicePurchaseRestriction } from "../middlewares/servicePurchaseRestriction.middleware.js";

const router = express.Router();
const quoteLimiter = authenticatedRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many airtime quote requests, please try again shortly",
});
const purchaseLimiter = authenticatedRateLimit({
  windowMs: 15 * 1000,
  max: 1,
  message: "Another airtime purchase was just submitted, please wait a moment",
});

router.get("/airtime/networks", protect, getAirtimeNetworks);
router.post("/airtime/quote", protect, quoteLimiter, quoteAirtime);
router.post(
  "/airtime/purchase",
  protect,
  enforceServicePurchaseRestriction,
  purchaseLimiter,
  purchaseAirtime
);

export default router;
