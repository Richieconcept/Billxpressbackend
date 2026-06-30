import mongoose from "mongoose";

const dataPlanSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      index: true,
    },
    providerPlanId: {
      type: String,
      required: true,
    },
    providerPlanCode: {
      type: String,
      default: "",
    },
    network: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    networkCode: {
      type: String,
      default: "",
    },
    name: {
      type: String,
      required: true,
    },
    dataType: {
      type: String,
      default: "OTHER",
      uppercase: true,
      index: true,
    },
    providerDataType: {
      type: String,
      default: "",
    },
    validity: {
      type: String,
      default: null,
    },
    validityDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    networkPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    providerPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    ourPrice: {
      type: Number,
      default: null,
      min: 0,
    },
    isEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    allowHostedSim: {
      type: Boolean,
      default: true,
    },
    allowWalletFallback: {
      type: Boolean,
      default: false,
    },
    providerAvailable: {
      type: Boolean,
      default: true,
    },
    raw: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastSyncedAt: {
      type: Date,
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

dataPlanSchema.index(
  { provider: 1, providerPlanId: 1 },
  { unique: true }
);

export default mongoose.model("DataPlan", dataPlanSchema);
