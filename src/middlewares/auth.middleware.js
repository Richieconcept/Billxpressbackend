import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

const AUTH_TIER_RANK = {
  tier_1: 1,
  tier_2: 2,
  tier_3: 3,
};

export const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: "Authentication credentials are required",
      });
    }

    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await User.findById(decoded.userId).select(
        "-password -transactionPin -emailVerificationOtp"
      );

      if (!user || !user.isActive) {
        return res.status(401).json({
          message: "User account is not active",
        });
      }

      req.user = user;
      return next();
    }

    const apiKey = authHeader.trim();
    const user = await User.findOne({ apiKey }).select(
      "-password -transactionPin -emailVerificationOtp"
    );

    if (!user || user.role !== "vendor" || user.isVendorActive !== true) {
      return res.status(401).json({
        message: "Invalid vendor API key",
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};

export const requireVerifiedEmail = (req, res, next) => {
  if (!req.user?.emailVerified) {
    return res.status(403).json({
      message: "Please verify your email to continue",
      requiresVerification: true,
    });
  }

  next();
};

export const requireAuthTier = (minimumTier = "tier_1") => {
  return (req, res, next) => {
    const userTier = req.user?.authTier || "tier_1";

    if ((AUTH_TIER_RANK[userTier] || 0) < (AUTH_TIER_RANK[minimumTier] || 0)) {
      return res.status(403).json({
        message: `${minimumTier} account tier required`,
        requiredTier: minimumTier,
        currentTier: userTier,
      });
    }

    next();
  };
};

export const requireVendor = (req, res, next) => {
  if (req.user?.role !== "vendor") {
    return res.status(403).json({
      message: "Vendor access required",
    });
  }

  next();
};

export const protectVendorApi = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Invalid vendor API key",
        code: "INVALID_API_KEY",
      });
    }

    const apiKey = authHeader.trim();
    const user = await User.findOne({ apiKey }).select(
      "-password -transactionPin -emailVerificationOtp"
    );

    if (!user || user.role !== "vendor" || user.isVendorActive !== true) {
      return res.status(401).json({
        success: false,
        message: "Invalid vendor API key",
        code: "INVALID_API_KEY",
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid vendor API key",
      code: "INVALID_API_KEY",
    });
  }
};

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You are not authorized to access this resource",
        requiredRoles: roles,
        currentRole: req.user?.role,
      });
    }

    next();
  };
};
