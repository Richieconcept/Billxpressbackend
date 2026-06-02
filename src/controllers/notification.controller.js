import Notification from "../models/notification.model.js";
import {
  deactivateDeviceToken,
  serializeDeviceToken,
  serializeNotification,
  upsertDeviceToken,
} from "../services/notification.service.js";

const sendNotificationError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

const getNotificationQuery = (req) => {
  const query = {
    user: req.user._id,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };

  if (req.query.status === "unread") {
    query.readAt = null;
  }

  if (req.query.status === "read") {
    query.readAt = { $ne: null };
  }

  if (req.query.type) {
    query.type = req.query.type;
  }

  return query;
};

export const listNotifications = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const query = getNotificationQuery(req);
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(query),
      Notification.countDocuments({
        user: req.user._id,
        readAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      }),
    ]);

    res.json({
      notifications: notifications.map((notification) =>
        serializeNotification(notification)
      ),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      unreadCount,
    });
  } catch (error) {
    sendNotificationError(res, "Could not fetch notifications", error);
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      readAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    });

    res.json({
      unreadCount,
    });
  } catch (error) {
    sendNotificationError(res, "Could not fetch unread count", error);
  }
};

export const getPopupNotifications = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const notifications = await Notification.find({
      user: req.user._id,
      seenAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    })
      .sort({ priority: -1, createdAt: -1 })
      .limit(limit);

    res.json({
      notifications: notifications.map((notification) =>
        serializeNotification(notification)
      ),
    });
  } catch (error) {
    sendNotificationError(res, "Could not fetch popup notifications", error);
  }
};

const updateOwnedNotification = async ({ req, update }) => {
  const notification = await Notification.findOneAndUpdate(
    {
      _id: req.params.notificationId,
      user: req.user._id,
    },
    update,
    { new: true }
  );

  if (!notification) {
    const error = new Error("Notification not found");
    error.statusCode = 404;
    throw error;
  }

  return notification;
};

export const markNotificationRead = async (req, res) => {
  try {
    const notification = await updateOwnedNotification({
      req,
      update: { readAt: new Date() },
    });

    res.json({
      message: "Notification marked as read",
      notification: serializeNotification(notification),
    });
  } catch (error) {
    sendNotificationError(res, "Could not mark notification as read", error);
  }
};

export const markNotificationSeen = async (req, res) => {
  try {
    const notification = await updateOwnedNotification({
      req,
      update: { seenAt: new Date() },
    });

    res.json({
      message: "Notification marked as seen",
      notification: serializeNotification(notification),
    });
  } catch (error) {
    sendNotificationError(res, "Could not mark notification as seen", error);
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      {
        user: req.user._id,
        readAt: null,
      },
      { readAt: new Date() }
    );

    res.json({
      message: "All notifications marked as read",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    sendNotificationError(res, "Could not mark all notifications as read", error);
  }
};

export const registerDeviceToken = async (req, res) => {
  try {
    const deviceToken = await upsertDeviceToken({
      userId: req.user._id,
      token: req.body?.token,
      provider: req.body?.provider || "expo",
      platform: req.body?.platform || "unknown",
      deviceName: req.body?.deviceName || null,
    });

    res.status(201).json({
      message: "Device token registered successfully",
      device: serializeDeviceToken(deviceToken),
    });
  } catch (error) {
    sendNotificationError(res, "Could not register device token", error);
  }
};

export const removeDeviceToken = async (req, res) => {
  try {
    const deviceToken = await deactivateDeviceToken({
      userId: req.user._id,
      token: req.body?.token,
    });

    res.json({
      message: "Device token removed successfully",
      device: deviceToken ? serializeDeviceToken(deviceToken) : null,
    });
  } catch (error) {
    sendNotificationError(res, "Could not remove device token", error);
  }
};
