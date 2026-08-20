import express from "express";
import {
  getCableTvPackages,
  getCableTvProviders,
  purchaseCableTv,
  quoteCableTv,
  verifyCableTvSmartcard,
} from "../controllers/cableTvService.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { authenticatedRateLimit } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();
const providerLookupLimiter = authenticatedRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many cable TV lookup requests, please try again shortly",
});
const purchaseLimiter = authenticatedRateLimit({
  windowMs: 15 * 1000,
  max: 1,
  message: "Another cable TV purchase was just submitted, please wait a moment",
});

router.get("/cable-tv/providers", protect, getCableTvProviders);
router.get("/cable-tv/packages", protect, getCableTvPackages);
router.post(
  "/cable-tv/verify-smartcard",
  protect,
  providerLookupLimiter,
  verifyCableTvSmartcard
);
router.post("/cable-tv/quote", protect, providerLookupLimiter, quoteCableTv);
router.post("/cable-tv/purchase", protect, purchaseLimiter, purchaseCableTv);

export default router;
