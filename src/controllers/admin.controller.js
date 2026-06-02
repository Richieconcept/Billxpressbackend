import User from "../models/user.model.js";
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
