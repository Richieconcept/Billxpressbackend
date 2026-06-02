import express from "express";
import {
  handleMonnifyWebhook,
  handlePocketFiWebhook,
} from "../controllers/webhook.controller.js";

const router = express.Router();

router.post("/pocketfi", handlePocketFiWebhook);
router.post("/monnify", handleMonnifyWebhook);

export default router;
