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
  "vtpass",
];

const networkProviderSchema = new mongoose.Schema(
  {
    MTN: {
      type: [String],
      enum: providerNames,
      default: undefined,
      validate: {
        validator: (providers) => !providers || providers.length <= 2,
        message: "MTN can have at most two data providers",
      },
    },
    AIRTEL: {
      type: [String],
      enum: providerNames,
      default: undefined,
      validate: {
        validator: (providers) => !providers || providers.length <= 2,
        message: "AIRTEL can have at most two data providers",
      },
    },
    GLO: {
      type: [String],
      enum: providerNames,
      default: undefined,
      validate: {
        validator: (providers) => !providers || providers.length <= 2,
        message: "GLO can have at most two data providers",
      },
    },
    "9MOBILE": {
      type: [String],
      enum: providerNames,
      default: undefined,
      validate: {
        validator: (providers) => !providers || providers.length <= 2,
        message: "9MOBILE can have at most two data providers",
      },
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
