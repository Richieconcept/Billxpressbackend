import express from "express";
import {
  getSocialGrowthOrder,
  getSocialGrowthServices,
  listSocialGrowthOrders,
  purchaseSocialGrowth,
  quoteSocialGrowth,
} from "../controllers/socialGrowth.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/social-growth/services", protect, getSocialGrowthServices);
router.post("/social-growth/quote", protect, quoteSocialGrowth);
router.post("/social-growth/orders", protect, purchaseSocialGrowth);
router.get("/social-growth/orders", protect, listSocialGrowthOrders);
router.get("/social-growth/orders/:orderId", protect, getSocialGrowthOrder);

export default router;
