import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    transactionPin: {
      type: String,
      required: true,
    },

    referralCode: {
      type: String,
      unique: true,
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    authTier: {
      type: String,
      enum: ["tier_1", "tier_2", "tier_3"],
      default: "tier_1",
    },

    kycLevel: {
      type: Number,
      default: 0,
      min: 0,
    },

    emailVerificationOtp: {
      type: String,
      default: null,
      select: false,
    },

    emailVerificationOtpExpires: {
      type: Date,
      default: null,
      select: false,
    },

    emailVerificationOtpLastSentAt: {
      type: Date,
      default: null,
      select: false,
    },

    transactionPinResetOtp: {
      type: String,
      default: null,
      select: false,
    },

    transactionPinResetOtpExpires: {
      type: Date,
      default: null,
      select: false,
    },

    transactionPinResetOtpLastSentAt: {
      type: Date,
      default: null,
      select: false,
    },

    referredBy: {
      type: String, // referral code of another user
      default: null,
    },

    role: {
      type: String,
      enum: ["user", "vendor", "admin"],
      default: "user",
    },

    apiKey: {
      type: String,
      unique: true,
      sparse: true,
    },

    discountRate: {
      type: Number,
      default: 0,
    },

    isVendorActive: {
      type: Boolean,
      default: false,
    },

    vendorApprovedAt: {
      type: Date,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("User", userSchema);
