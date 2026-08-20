import express from "express";
import {
  getDataPlans,
  purchaseData,
} from "../controllers/dataService.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { authenticatedRateLimit } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();
const purchaseLimiter = authenticatedRateLimit({
  windowMs: 60 * 1000,
  max: 8,
  message: "Too many data purchase requests, please slow down",
});

router.get("/data/plans", protect, getDataPlans);
router.post("/data/purchase", protect, purchaseLimiter, purchaseData);

export default router;
