import express from "express";
import {
  handleMapleradWebhook,
  handleMonnifyWebhook,
  handlePocketFiWebhook,
} from "../controllers/webhook.controller.js";

const router = express.Router();

router.post("/pocketfi", handlePocketFiWebhook);
router.post("/monnify", handleMonnifyWebhook);
router.post("/maplerad", handleMapleradWebhook);

export default router;
