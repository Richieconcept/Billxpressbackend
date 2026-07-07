import mongoose from "mongoose";

const pricingTierSchema = new mongoose.Schema(
  {
    minCost: {
      type: Number,
      required: true,
      min: 0,
    },

    maxCost: {
      type: Number,
      default: null,
      min: 0,
    },

    markupPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
  },
  { _id: false }
);

const socialGrowthServiceSettingSchema = new mongoose.Schema(
  {
    service: {
      type: String,
      default: "social_growth",
      unique: true,
      immutable: true,
    },

    isEnabled: {
      type: Boolean,
      default: true,
    },

    activeProvider: {
      type: String,
      enum: ["exosupplier", "vheeboost"],
      default: "exosupplier",
    },

    userMarkupPercent: {
      type: Number,
      default: 15,
      min: 0,
      max: 100,
    },

    vendorMarkupPercent: {
      type: Number,
      default: 10,
      min: 0,
      max: 100,
    },

    usdToNgnRate: {
      type: Number,
      default: 1600,
      min: 1,
    },

    userPricingTiers: {
      type: [pricingTierSchema],
      default: [
        { minCost: 0, maxCost: 1000, markupPercent: 15 },
        { minCost: 1001, maxCost: 5000, markupPercent: 10 },
        { minCost: 5001, maxCost: 15000, markupPercent: 7 },
        { minCost: 15001, maxCost: 50000, markupPercent: 5 },
        { minCost: 50001, maxCost: null, markupPercent: 3 },
      ],
    },

    vendorPricingTiers: {
      type: [pricingTierSchema],
      default: [
        { minCost: 0, maxCost: 1000, markupPercent: 10 },
        { minCost: 1001, maxCost: 5000, markupPercent: 7 },
        { minCost: 5001, maxCost: 15000, markupPercent: 5 },
        { minCost: 15001, maxCost: 50000, markupPercent: 3 },
        { minCost: 50001, maxCost: null, markupPercent: 2 },
      ],
    },

    roundingMode: {
      type: String,
      enum: ["ceil", "round"],
      default: "ceil",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "SocialGrowthServiceSetting",
  socialGrowthServiceSettingSchema
);
