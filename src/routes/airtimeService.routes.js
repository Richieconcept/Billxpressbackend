import express from "express";
import {
  getAirtimeNetworks,
  purchaseAirtime,
  quoteAirtime,
} from "../controllers/airtimeService.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/airtime/networks", protect, getAirtimeNetworks);
router.post("/airtime/quote", protect, quoteAirtime);
router.post("/airtime/purchase", protect, purchaseAirtime);

export default router;
