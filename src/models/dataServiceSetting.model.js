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

const providerNames = [
  "smeapi",
  "ujaydata",
  "autopilot",
  "smeplug",
  "ogdams",
  "2fast",
];

const networkProviderSchema = new mongoose.Schema(
  {
    MTN: {
      type: String,
      enum: providerNames,
      default: null,
    },
    AIRTEL: {
      type: String,
      enum: providerNames,
      default: null,
    },
    GLO: {
      type: String,
      enum: providerNames,
      default: null,
    },
    "9MOBILE": {
      type: String,
      enum: providerNames,
      default: null,
    },
  },
  { _id: false }
);

const dataServiceSettingSchema = new mongoose.Schema(
  {
    service: {
      type: String,
      default: "data",
      unique: true,
      immutable: true,
    },

    isEnabled: {
      type: Boolean,
      default: true,
    },

    activeProvider: {
      type: String,
      enum: providerNames,
      default: "smeapi",
    },

    networkProviders: {
      type: networkProviderSchema,
      default: () => ({}),
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

    userPricingTiers: {
      type: [pricingTierSchema],
      default: [],
    },

    vendorPricingTiers: {
      type: [pricingTierSchema],
      default: [],
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

export default mongoose.model("DataServiceSetting", dataServiceSettingSchema);
