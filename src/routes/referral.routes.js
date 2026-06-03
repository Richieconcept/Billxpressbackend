import express from "express";
import {
  getReferralSummary,
  listReferralRewards,
  listReferredUsers,
} from "../controllers/referral.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/summary", getReferralSummary);
router.get("/rewards", listReferralRewards);
router.get("/referred-users", listReferredUsers);

export default router;
