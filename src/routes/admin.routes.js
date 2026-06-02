import express from "express";
import {
  bootstrapFirstAdmin,
  listAdmins,
  makeAdmin,
  makeVendor,
  removeAdmin,
} from "../controllers/admin.controller.js";
import { authorizeRoles, protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.patch("/bootstrap-admin/:userId", bootstrapFirstAdmin);
router.get("/admins", protect, authorizeRoles("admin"), listAdmins);
router.patch("/make-admin/:userId", protect, authorizeRoles("admin"), makeAdmin);
router.patch(
  "/remove-admin/:userId",
  protect,
  authorizeRoles("admin"),
  removeAdmin
);
router.patch("/make-vendor/:userId", protect, authorizeRoles("admin"), makeVendor);

export default router;
