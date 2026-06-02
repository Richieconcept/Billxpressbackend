import express from "express";
import {
  bootstrapFirstAdmin,
  createAdminNotification,
  listAdmins,
  listAdminNotifications,
  makeAdmin,
  makeVendor,
  removeAdmin,
} from "../controllers/admin.controller.js";
import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  setUserStatus,
  updateUser,
} from "../controllers/adminUser.controller.js";
import { authorizeRoles, protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.patch("/bootstrap-admin/:userId", bootstrapFirstAdmin);
router.get("/users", protect, authorizeRoles("admin"), listUsers);
router.post("/users", protect, authorizeRoles("admin"), createUser);
router.get("/users/:userId", protect, authorizeRoles("admin"), getUser);
router.patch("/users/:userId", protect, authorizeRoles("admin"), updateUser);
router.patch(
  "/users/:userId/status",
  protect,
  authorizeRoles("admin"),
  setUserStatus
);
router.delete("/users/:userId", protect, authorizeRoles("admin"), deleteUser);
router.get("/admins", protect, authorizeRoles("admin"), listAdmins);
router.patch("/make-admin/:userId", protect, authorizeRoles("admin"), makeAdmin);
router.get(
  "/notifications",
  protect,
  authorizeRoles("admin"),
  listAdminNotifications
);
router.post(
  "/notifications",
  protect,
  authorizeRoles("admin"),
  createAdminNotification
);
router.patch(
  "/remove-admin/:userId",
  protect,
  authorizeRoles("admin"),
  removeAdmin
);
router.patch("/make-vendor/:userId", protect, authorizeRoles("admin"), makeVendor);

export default router;
