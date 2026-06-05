import express from "express";
import {
  getDataPlans,
  purchaseData,
} from "../controllers/dataService.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/data/plans", protect, getDataPlans);
router.post("/data/purchase", protect, purchaseData);

export default router;
