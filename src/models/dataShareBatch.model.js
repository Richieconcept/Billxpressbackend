import mongoose from "mongoose";

const dataShareBatchSchema = new mongoose.Schema(
  {
    sim: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DataShareSim",
      required: true,
      index: true,
    },
    simPhoneNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    groupName: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    network: {
      type: String,
      default: "MTN",
      enum: ["MTN"],
      index: true,
    },
    totalMb: {
      type: Number,
      required: true,
      min: 1,
    },
    remainingMb: {
      type: Number,
      required: true,
      min: 0,
    },
    totalCost: {
      type: Number,
      required: true,
      min: 0,
    },
    costPerMb: {
      type: Number,
      required: true,
      min: 0,
    },
    soldMb: {
      type: Number,
      default: 0,
      min: 0,
    },
    revenue: {
      type: Number,
      default: 0,
      min: 0,
    },
    costSpent: {
      type: Number,
      default: 0,
      min: 0,
    },
    profit: {
      type: Number,
      default: 0,
    },
    validity: {
      type: String,
      default: "",
      trim: true,
    },
    activeFrom: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "exhausted", "expired", "disabled"],
      default: "active",
      index: true,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

dataShareBatchSchema.index({ simPhoneNumber: 1, status: 1, expiresAt: 1 });

export default mongoose.model("DataShareBatch", dataShareBatchSchema);
