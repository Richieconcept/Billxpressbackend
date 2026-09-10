import express from "express";
import { getSliders } from "../controllers/slider.controller.js";

const router = express.Router();

router.get("/", getSliders);

export default router;
