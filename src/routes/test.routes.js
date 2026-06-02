import express from "express";
import { getTestUser, getTestVendor } from "../controllers/test.controller.js";
import { protect, requireVendor } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/user", protect, getTestUser);
router.get("/vendor", protect, requireVendor, getTestVendor);

export default router;
