import DeviceToken from "../models/deviceToken.model.js";
import Notification from "../models/notification.model.js";
import User from "../models/user.model.js";
import { sendEmail } from "../utils/sendEmail.js";
import { sendExpoPushNotifications } from "./pushNotification.service.js";

const EMAIL_CHANNELS = new Set(["email", "both", "all"]);
const PUSH_CHANNELS = new Set(["push", "both", "all"]);

export const serializeNotification = (notification) => ({
  id: notification._id,
  title: notification.title,
  message: notification.message,
  type: notification.type,
  priority: notification.priority,
  channel: notification.channel,
  data: notification.data || {},
  readAt: notification.readAt,
  seenAt: notification.seenAt,
  deliveredAt: notification.deliveredAt,
  expiresAt: notification.expiresAt,
  createdBy: notification.createdBy,
  createdAt: notification.createdAt,
  updatedAt: notification.updatedAt,
});

export const serializeDeviceToken = (deviceToken) => ({
  id: deviceToken._id,
  provider: deviceToken.provider,
  platform: deviceToken.platform,
  deviceName: deviceToken.deviceName,
  isActive: deviceToken.isActive,
  lastUsedAt: deviceToken.lastUsedAt,
  createdAt: deviceToken.createdAt,
});

const shouldSendEmail = (channel) => EMAIL_CHANNELS.has(channel);
const shouldSendPush = (channel) => PUSH_CHANNELS.has(channel);

const sendNotificationEmail = async ({ user, title, message }) => {
  try {
    await sendEmail({
      to: user.email,
      name: `${user.firstName} ${user.lastName}`.trim() || user.username,
      subject: title,
      textContent: message,
      htmlContent: `<p>${message}</p>`,
    });

    return {
      attempted: true,
      successful: true,
      error: null,
    };
  } catch (error) {
    return {
      attempted: true,
      successful: false,
      error: error.message,
    };
  }
};

const sendNotificationPush = async ({ userId, title, message, data }) => {
  const deviceTokens = await DeviceToken.find({
    user: userId,
    provider: "expo",
    isActive: true,
  });

  return sendExpoPushNotifications({
    tokens: deviceTokens.map((deviceToken) => deviceToken.token),
    title,
    message,
    data,
  });
};

export const createNotification = async ({
  userId,
  title,
  message,
  type = "system",
  channel = "in_app",
  priority = "normal",
  data = {},
  createdBy = null,
  expiresAt = null,
}) => {
  const user = await User.findById(userId);

  if (!user || !user.isActive) {
    const error = new Error("Notification user not found or inactive");
    error.statusCode = 404;
    throw error;
  }

  const notification = await Notification.create({
    user: user._id,
    title,
    message,
    type,
    channel,
    priority,
    data,
    createdBy,
    expiresAt,
  });

  if (shouldSendPush(channel)) {
    const pushDelivery = await sendNotificationPush({
      userId: user._id,
      title,
      message,
      data: {
        notificationId: String(notification._id),
        type,
        ...data,
      },
    });

    notification.pushDelivery = {
      attempted: Boolean(pushDelivery.attempted),
      successful: Boolean(pushDelivery.successful),
      error: pushDelivery.error || null,
    };
  }

  if (shouldSendEmail(channel)) {
    const emailDelivery = await sendNotificationEmail({
      user,
      title,
      message,
    });

    notification.emailDelivery = emailDelivery;
  }

  if (
    notification.pushDelivery?.successful ||
    notification.emailDelivery?.successful ||
    channel === "in_app"
  ) {
    notification.deliveredAt = new Date();
  }

  await notification.save();

  return notification;
};

export const createNotificationBestEffort = async (payload) => {
  try {
    return await createNotification(payload);
  } catch (error) {
    console.error("Notification creation failed", error);
    return null;
  }
};

export const createNotificationsForUsers = async ({
  userIds,
  title,
  message,
  type = "admin_announcement",
  channel = "in_app",
  priority = "normal",
  data = {},
  createdBy = null,
  expiresAt = null,
}) => {
  const results = [];

  for (const userId of userIds) {
    const notification = await createNotification({
      userId,
      title,
      message,
      type,
      channel,
      priority,
      data,
      createdBy,
      expiresAt,
    }).catch((error) => ({
      error: error.message,
      userId,
    }));

    results.push(notification);
  }

  return results;
};

export const upsertDeviceToken = async ({
  userId,
  token,
  provider = "expo",
  platform = "unknown",
  deviceName = null,
}) => {
  if (!token) {
    const error = new Error("Device token is required");
    error.statusCode = 400;
    throw error;
  }

  const deviceToken = await DeviceToken.findOneAndUpdate(
    { token },
    {
      user: userId,
      token,
      provider,
      platform,
      deviceName,
      isActive: true,
      lastUsedAt: new Date(),
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  return deviceToken;
};

export const deactivateDeviceToken = async ({ userId, token }) => {
  if (!token) {
    const error = new Error("Device token is required");
    error.statusCode = 400;
    throw error;
  }

  const deviceToken = await DeviceToken.findOneAndUpdate(
    { user: userId, token },
    { isActive: false },
    { new: true }
  );

  return deviceToken;
};
