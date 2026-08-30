import mongoose from "mongoose";

const dataShareSimSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    label: {
      type: String,
      default: "",
      trim: true,
    },
    groupName: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    activeFromDay: {
      type: Number,
      default: 1,
      min: 1,
      max: 31,
    },
    activeToDay: {
      type: Number,
      default: 10,
      min: 1,
      max: 31,
    },
    dailyLimitMb: {
      type: Number,
      default: 5120,
      min: 0,
    },
    monthlyShareLimit: {
      type: Number,
      default: 10,
      min: 0,
    },
    lastProviderReportedRemainingMb: {
      type: Number,
      default: null,
      min: 0,
    },
    lastProviderReportedAt: {
      type: Date,
      default: null,
    },
    defaultReloadMb: {
      type: Number,
      default: 0,
      min: 0,
    },
    defaultReloadCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    defaultReloadValidity: {
      type: String,
      default: "",
      trim: true,
    },
    defaultReloadExpiresAfterDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "paused", "retired"],
      default: "active",
      index: true,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("DataShareSim", dataShareSimSchema);
