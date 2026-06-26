import mongoose from "mongoose";

const electricityServiceSettingSchema = new mongoose.Schema(
  {
    service: {
      type: String,
      default: "electricity",
      unique: true,
      immutable: true,
    },

    isEnabled: {
      type: Boolean,
      default: true,
    },

    activeProvider: {
      type: String,
      enum: ["vtpass"],
      default: "vtpass",
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
      default: () => Number(process.env.ELECTRICITY_MIN_AMOUNT || 100),
      min: 1,
    },

    maximumAmount: {
      type: Number,
      default: () => Number(process.env.ELECTRICITY_MAX_AMOUNT || 500000),
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
  "ElectricityServiceSetting",
  electricityServiceSettingSchema
);
