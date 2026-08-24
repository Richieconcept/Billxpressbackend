import express from "express";
import {
  handleFlutterwaveWebhook,
  handleMapleradWebhook,
  handleMonnifyWebhook,
  handlePocketFiWebhook,
} from "../controllers/webhook.controller.js";

const router = express.Router();

router.post("/pocketfi", handlePocketFiWebhook);
router.post("/monnify", handleMonnifyWebhook);
router.post("/maplerad", handleMapleradWebhook);
router.post("/flutterwave", handleFlutterwaveWebhook);

export default router;
