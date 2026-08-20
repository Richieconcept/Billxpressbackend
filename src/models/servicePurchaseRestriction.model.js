import mongoose from "mongoose";

const servicePurchaseRestrictionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    restrictedUntil: {
      type: Date,
      required: true,
      index: true,
    },

    strikeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastFailureCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastFailureWindowStartedAt: {
      type: Date,
      default: null,
    },

    lastRestrictedAt: {
      type: Date,
      default: null,
    },

    reason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

servicePurchaseRestrictionSchema.index(
  { restrictedUntil: 1 },
  { expireAfterSeconds: 24 * 60 * 60 }
);

export default mongoose.model(
  "ServicePurchaseRestriction",
  servicePurchaseRestrictionSchema
);
