import express from "express";
import {
  getPopupNotifications,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationSeen,
  registerDeviceToken,
  removeDeviceToken,
} from "../controllers/notification.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/", listNotifications);
router.get("/unread-count", getUnreadCount);
router.get("/popup", getPopupNotifications);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:notificationId/read", markNotificationRead);
router.patch("/:notificationId/seen", markNotificationSeen);
router.post("/devices", registerDeviceToken);
router.delete("/devices", removeDeviceToken);

export default router;
