import User from "../models/user.model.js";
import Notification from "../models/notification.model.js";
import {
  createNotificationsForUsers,
  serializeNotification,
} from "../services/notification.service.js";
import { generateApiKey } from "../utils/generateApiKey.js";
import { sanitizeUser } from "../utils/sanitizeUser.js";

const generateUniqueApiKey = async () => {
  let apiKey = generateApiKey();

  while (await User.exists({ apiKey })) {
    apiKey = generateApiKey();
  }

  return apiKey;
};

const sendAdminError = (res, publicMessage, error) => {
  res.status(500).json({
    message: publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

export const listAdmins = async (req, res) => {
  try {
    const admins = await User.find({ role: "admin" })
      .select("-password -transactionPin -emailVerificationOtp")
      .sort({ createdAt: -1 });

    res.json({
      admins: admins.map((admin) => sanitizeUser(admin)),
    });
  } catch (error) {
    sendAdminError(res, "Could not fetch admins", error);
  }
};

const promoteUserToAdmin = async (user) => {
  user.role = "admin";
  user.apiKey = undefined;
  user.discountRate = 0;
  user.isVendorActive = false;
  user.vendorApprovedAt = undefined;

  await user.save();

  return user;
};

export const bootstrapFirstAdmin = async (req, res) => {
  try {
    const setupSecret = process.env.ADMIN_SETUP_SECRET;
    const providedSecret = req.headers["x-admin-setup-secret"];

    if (!setupSecret) {
      return res.status(403).json({
        message: "Admin setup is not enabled",
      });
    }

    if (!providedSecret || providedSecret !== setupSecret) {
      return res.status(403).json({
        message: "Invalid admin setup secret",
      });
    }

    const activeAdminCount = await User.countDocuments({
      role: "admin",
      isActive: true,
    });

    if (activeAdminCount > 0) {
      return res.status(400).json({
        message: "An active admin already exists",
      });
    }

    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        message: "Inactive users cannot be made admin",
      });
    }

    await promoteUserToAdmin(user);

    res.json({
      message: "First admin created successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendAdminError(res, "Could not create first admin", error);
  }
};

export const makeAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        message: "Inactive users cannot be made admin",
      });
    }

    if (user.role === "admin") {
      return res.status(400).json({
        message: "User is already an admin",
      });
    }

    await promoteUserToAdmin(user);

    res.json({
      message: "User upgraded to admin successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendAdminError(res, "Could not upgrade user to admin", error);
  }
};

export const removeAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({
        message: "You cannot remove your own admin role",
      });
    }

    if (user.role !== "admin") {
      return res.status(400).json({
        message: "User is not an admin",
      });
    }

    const adminCount = await User.countDocuments({
      role: "admin",
      isActive: true,
    });

    if (adminCount <= 1) {
      return res.status(400).json({
        message: "At least one active admin must remain",
      });
    }

    user.role = "user";

    await user.save();

    res.json({
      message: "Admin role removed successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendAdminError(res, "Could not remove admin role", error);
  }
};

export const makeVendor = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (user.role === "vendor") {
      return res.status(400).json({
        message: "User is already a vendor",
      });
    }

    if (user.role === "admin") {
      return res.status(400).json({
        message: "Admins cannot be upgraded to vendor",
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        message: "Inactive users cannot be made vendor",
      });
    }

    user.role = "vendor";
    user.apiKey = await generateUniqueApiKey();
    user.discountRate = 0.2;
    user.isVendorActive = true;
    user.vendorApprovedAt = new Date();

    await user.save();

    res.json({
      message: "User upgraded to vendor successfully",
      user: sanitizeUser(user),
      apiKey: user.apiKey,
    });
  } catch (error) {
    sendAdminError(res, "Could not upgrade user to vendor", error);
  }
};

export const createAdminNotification = async (req, res) => {
  try {
    const {
      target = "user",
      userId,
      title,
      message,
      type = "admin_announcement",
      channel = "in_app",
      priority = "normal",
      data = {},
      expiresAt,
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        message: "Title and message are required",
      });
    }

    let userIds = [];

    if (target === "user") {
      if (!userId) {
        return res.status(400).json({
          message: "userId is required when target is user",
        });
      }

      const user = await User.findById(userId);

      if (!user || !user.isActive) {
        return res.status(404).json({
          message: "Target user not found or inactive",
        });
      }

      userIds = [user._id];
    } else if (target === "all") {
      const users = await User.find({ isActive: true }).select("_id");
      userIds = users.map((user) => user._id);
    } else {
      return res.status(400).json({
        message: "target must be user or all",
      });
    }

    const results = await createNotificationsForUsers({
      userIds,
      title,
      message,
      type,
      channel,
      priority,
      data,
      createdBy: req.user._id,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });
    const successful = results.filter((result) => !result.error);
    const failed = results.filter((result) => result.error);

    res.status(201).json({
      message: "Notification created successfully",
      target,
      requestedCount: userIds.length,
      createdCount: successful.length,
      failedCount: failed.length,
      notifications: successful.slice(0, 20).map((notification) =>
        serializeNotification(notification)
      ),
      errors: failed,
    });
  } catch (error) {
    sendAdminError(res, "Could not create notification", error);
  }
};

export const listAdminNotifications = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const query = {};

    if (req.query.type) {
      query.type = req.query.type;
    }

    if (req.query.userId) {
      query.user = req.query.userId;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate("user", "firstName lastName username email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments(query),
    ]);

    res.json({
      notifications: notifications.map((notification) => ({
        ...serializeNotification(notification),
        user: notification.user,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendAdminError(res, "Could not fetch notifications", error);
  }
};
