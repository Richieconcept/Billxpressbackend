import express from "express";
import {
  getElectricityDiscos,
  purchaseElectricity,
  quoteElectricity,
  verifyElectricityMeter,
} from "../controllers/electricityService.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { authenticatedRateLimit } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();
const providerLookupLimiter = authenticatedRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many electricity lookup requests, please try again shortly",
});
const purchaseLimiter = authenticatedRateLimit({
  windowMs: 60 * 1000,
  max: 8,
  message: "Too many electricity purchase requests, please slow down",
});

router.get("/electricity/discos", protect, getElectricityDiscos);
router.post(
  "/electricity/verify-meter",
  protect,
  providerLookupLimiter,
  verifyElectricityMeter
);
router.post("/electricity/quote", protect, providerLookupLimiter, quoteElectricity);
router.post("/electricity/purchase", protect, purchaseLimiter, purchaseElectricity);

export default router;
