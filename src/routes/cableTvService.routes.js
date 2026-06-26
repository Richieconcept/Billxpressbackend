import express from "express";
import {
  getCableTvPackages,
  getCableTvProviders,
  purchaseCableTv,
  quoteCableTv,
  verifyCableTvSmartcard,
} from "../controllers/cableTvService.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/cable-tv/providers", protect, getCableTvProviders);
router.get("/cable-tv/packages", protect, getCableTvPackages);
router.post("/cable-tv/verify-smartcard", protect, verifyCableTvSmartcard);
router.post("/cable-tv/quote", protect, quoteCableTv);
router.post("/cable-tv/purchase", protect, purchaseCableTv);

export default router;
