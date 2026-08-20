import express from "express";
import {
  getAirtimeNetworks,
  purchaseAirtime,
  quoteAirtime,
} from "../controllers/airtimeService.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { authenticatedRateLimit } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();
const quoteLimiter = authenticatedRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many airtime quote requests, please try again shortly",
});
const purchaseLimiter = authenticatedRateLimit({
  windowMs: 60 * 1000,
  max: 8,
  message: "Too many airtime purchase requests, please slow down",
});

router.get("/airtime/networks", protect, getAirtimeNetworks);
router.post("/airtime/quote", protect, quoteLimiter, quoteAirtime);
router.post("/airtime/purchase", protect, purchaseLimiter, purchaseAirtime);

export default router;
