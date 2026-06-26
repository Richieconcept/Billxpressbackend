import express from "express";
import {
  getElectricityDiscos,
  purchaseElectricity,
  quoteElectricity,
  verifyElectricityMeter,
} from "../controllers/electricityService.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/electricity/discos", protect, getElectricityDiscos);
router.post("/electricity/verify-meter", protect, verifyElectricityMeter);
router.post("/electricity/quote", protect, quoteElectricity);
router.post("/electricity/purchase", protect, purchaseElectricity);

export default router;
