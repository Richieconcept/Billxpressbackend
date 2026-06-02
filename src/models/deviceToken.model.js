import mongoose from "mongoose";

const deviceTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    provider: {
      type: String,
      enum: ["expo", "fcm", "apns"],
      default: "expo",
      index: true,
    },

    platform: {
      type: String,
      enum: ["android", "ios", "web", "unknown"],
      default: "unknown",
    },

    deviceName: {
      type: String,
      trim: true,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

deviceTokenSchema.index({ user: 1, isActive: 1 });

export default mongoose.model("DeviceToken", deviceTokenSchema);
