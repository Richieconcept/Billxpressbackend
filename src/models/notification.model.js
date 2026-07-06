import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    type: {
      type: String,
      enum: [
        "admin_announcement",
        "wallet_funding_success",
        "wallet_funding_failed",
        "service_purchase_success",
        "service_purchase_failed",
        "service_purchase_refunded",
        "referral_reward",
        "referral_redeem_success",
        "kyc_update",
        "card_maintenance",
        "security",
        "system",
      ],
      default: "system",
      index: true,
    },

    priority: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
      index: true,
    },

    channel: {
      type: String,
      enum: ["in_app", "push", "email", "both", "all"],
      default: "in_app",
    },

    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    readAt: {
      type: Date,
      default: null,
      index: true,
    },

    seenAt: {
      type: Date,
      default: null,
      index: true,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    pushDelivery: {
      attempted: {
        type: Boolean,
        default: false,
      },
      successful: {
        type: Boolean,
        default: false,
      },
      error: {
        type: String,
        default: null,
      },
    },

    emailDelivery: {
      attempted: {
        type: Boolean,
        default: false,
      },
      successful: {
        type: Boolean,
        default: false,
      },
      error: {
        type: String,
        default: null,
      },
    },

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ user: 1, seenAt: 1, priority: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
