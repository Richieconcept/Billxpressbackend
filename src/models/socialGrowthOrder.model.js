import mongoose from "mongoose";

const socialGrowthOrderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    provider: {
      type: String,
      default: "vheeboost",
      index: true,
    },

    providerOrderId: {
      type: String,
      index: true,
      sparse: true,
    },

    serviceId: {
      type: String,
      required: true,
      index: true,
    },

    serviceName: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      trim: true,
    },

    link: {
      type: String,
      required: true,
      trim: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    runs: {
      type: Number,
      default: null,
      min: 1,
    },

    interval: {
      type: Number,
      default: null,
      min: 1,
    },

    costPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    profit: {
      type: Number,
      required: true,
      min: 0,
    },

    markupPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "in_progress",
        "completed",
        "partial",
        "canceled",
        "failed",
        "refunded",
      ],
      default: "pending",
      index: true,
    },

    startCount: {
      type: Number,
      default: null,
    },

    remains: {
      type: Number,
      default: null,
    },

    charge: {
      type: Number,
      default: null,
    },

    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
      trim: true,
    },

    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },

    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("SocialGrowthOrder", socialGrowthOrderSchema);
