import mongoose from "mongoose";

const airtimeServiceSettingSchema = new mongoose.Schema(
  {
    service: {
      type: String,
      default: "airtime",
      unique: true,
      immutable: true,
    },

    isEnabled: {
      type: Boolean,
      default: true,
    },

    activeProvider: {
      type: String,
      enum: ["ujaydata"],
      default: "ujaydata",
    },

    userMarkupPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    vendorMarkupPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    roundingMode: {
      type: String,
      enum: ["ceil", "round"],
      default: "ceil",
    },

    minimumAmount: {
      type: Number,
      default: () => Number(process.env.AIRTIME_MIN_AMOUNT || 50),
      min: 1,
    },

    maximumAmount: {
      type: Number,
      default: () => Number(process.env.AIRTIME_MAX_AMOUNT || 50000),
      min: 1,
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
  "AirtimeServiceSetting",
  airtimeServiceSettingSchema
);
