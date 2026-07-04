import express from "express";
import {
  bootstrapFirstAdmin,
  createAdminNotification,
  getAdminDashboardEarnings,
  listAdmins,
  listAdminNotifications,
  makeAdmin,
  makeVendor,
  removeAdmin,
} from "../controllers/admin.controller.js";
import {
  getAdminAirtimeSettings,
  updateAdminAirtimeSettings,
} from "../controllers/airtimeService.controller.js";
import {
  getAdminCableTvSettings,
  updateAdminCableTvSettings,
} from "../controllers/cableTvService.controller.js";
import {
  getAdminDataPlans,
  getAdminDataSettings,
  reconcileAdminDataTransaction,
  syncAdminDataPlans,
  updateAdminDataPlanById,
  updateAdminDataSettings,
} from "../controllers/dataService.controller.js";
import {
  getAdminElectricitySettings,
  updateAdminElectricitySettings,
} from "../controllers/electricityService.controller.js";
import {
  getAdminSocialGrowthSettings,
  updateAdminSocialGrowthSettings,
} from "../controllers/socialGrowth.controller.js";
import {
  getAdminCardSettings,
  updateAdminCardSettings,
} from "../controllers/card.controller.js";
import {
  getAdminMapleradInstitutions,
  getAdminFundingFeeSettings,
  updateAdminFundingFeeSetting,
} from "../controllers/fundingFee.controller.js";
import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  setUserStatus,
  updateUser,
} from "../controllers/adminUser.controller.js";
import { listAdminReferralRewards } from "../controllers/referral.controller.js";
import { authorizeRoles, protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.patch("/bootstrap-admin/:userId", bootstrapFirstAdmin);
router.get(
  "/dashboard/earnings",
  protect,
  authorizeRoles("admin"),
  getAdminDashboardEarnings
);
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
router.get(
  "/referrals/rewards",
  protect,
  authorizeRoles("admin"),
  listAdminReferralRewards
);
router.get(
  "/services/airtime/settings",
  protect,
  authorizeRoles("admin"),
  getAdminAirtimeSettings
);
router.patch(
  "/services/airtime/settings",
  protect,
  authorizeRoles("admin"),
  updateAdminAirtimeSettings
);
router.get(
  "/services/cable-tv/settings",
  protect,
  authorizeRoles("admin"),
  getAdminCableTvSettings
);
router.patch(
  "/services/cable-tv/settings",
  protect,
  authorizeRoles("admin"),
  updateAdminCableTvSettings
);
router.get(
  "/services/data/settings",
  protect,
  authorizeRoles("admin"),
  getAdminDataSettings
);
router.patch(
  "/services/data/settings",
  protect,
  authorizeRoles("admin"),
  updateAdminDataSettings
);
router.get(
  "/services/data/plans",
  protect,
  authorizeRoles("admin"),
  getAdminDataPlans
);
router.post(
  "/services/data/plans/sync",
  protect,
  authorizeRoles("admin"),
  syncAdminDataPlans
);
router.post(
  "/services/data/transactions/:reference/reconcile",
  protect,
  authorizeRoles("admin"),
  reconcileAdminDataTransaction
);
router.patch(
  "/services/data/plans/:planId",
  protect,
  authorizeRoles("admin"),
  updateAdminDataPlanById
);
router.get(
  "/services/electricity/settings",
  protect,
  authorizeRoles("admin"),
  getAdminElectricitySettings
);
router.patch(
  "/services/electricity/settings",
  protect,
  authorizeRoles("admin"),
  updateAdminElectricitySettings
);
router.get(
  "/services/social-growth/settings",
  protect,
  authorizeRoles("admin"),
  getAdminSocialGrowthSettings
);
router.patch(
  "/services/social-growth/settings",
  protect,
  authorizeRoles("admin"),
  updateAdminSocialGrowthSettings
);
router.get(
  "/cards/settings",
  protect,
  authorizeRoles("admin"),
  getAdminCardSettings
);
router.patch(
  "/cards/settings",
  protect,
  authorizeRoles("admin"),
  updateAdminCardSettings
);
router.get(
  "/funding/settings",
  protect,
  authorizeRoles("admin"),
  getAdminFundingFeeSettings
);
router.get(
  "/funding/maplerad/institutions",
  protect,
  authorizeRoles("admin"),
  getAdminMapleradInstitutions
);
router.patch(
  "/funding/settings",
  protect,
  authorizeRoles("admin"),
  updateAdminFundingFeeSetting
);
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
