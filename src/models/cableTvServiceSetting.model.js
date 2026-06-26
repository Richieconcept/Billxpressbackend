import mongoose from "mongoose";

const cableTvServiceSettingSchema = new mongoose.Schema(
  {
    service: {
      type: String,
      default: "cable_tv",
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

export default mongoose.model("CableTvServiceSetting", cableTvServiceSettingSchema);
