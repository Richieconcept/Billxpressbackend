import express from "express";
import {
  getAirtimeNetworks,
  purchaseAirtime,
  quoteAirtime,
} from "../controllers/airtimeService.controller.js";
import {
  getDataPlans,
  purchaseData,
} from "../controllers/dataService.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/airtime/networks", protect, getAirtimeNetworks);
router.post("/airtime/quote", protect, quoteAirtime);
router.post("/airtime/purchase", protect, purchaseAirtime);
router.get("/data/plans", protect, getDataPlans);
router.post("/data/purchase", protect, purchaseData);

export default router;
