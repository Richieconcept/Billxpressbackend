import express from "express";
import {
  changeMyPassword,
  changeMyTransactionPin,
  deactivateMyAccount,
  getMyProfile,
  updateMyProfile,
} from "../controllers/user.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/me", getMyProfile);
router.patch("/me", updateMyProfile);
router.patch("/me/password", changeMyPassword);
router.patch("/me/transaction-pin", changeMyTransactionPin);
router.delete("/me", deactivateMyAccount);

export default router;
