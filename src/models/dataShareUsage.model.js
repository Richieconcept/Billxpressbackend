import mongoose from "mongoose";

const dataShareUsageSchema = new mongoose.Schema(
  {
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      unique: true,
      index: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    provider: {
      type: String,
      default: "2fast",
      index: true,
    },
    providerReference: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DataShareBatch",
      default: null,
      index: true,
    },
    sim: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DataShareSim",
      default: null,
      index: true,
    },
    simPhoneNumber: {
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
    volume: {
      type: String,
      default: "",
      trim: true,
    },
    validity: {
      type: String,
      default: "",
      trim: true,
    },
    soldMb: {
      type: Number,
      default: 0,
      min: 0,
    },
    sellingPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    costPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    profit: {
      type: Number,
      default: 0,
    },
    providerReportedRemainingMb: {
      type: Number,
      default: null,
      min: 0,
    },
    status: {
      type: String,
      enum: ["matched", "unmatched", "lookup_failed"],
      default: "unmatched",
      index: true,
    },
    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

dataShareUsageSchema.index({ simPhoneNumber: 1, createdAt: -1 });

export default mongoose.model("DataShareUsage", dataShareUsageSchema);
