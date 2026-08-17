import mongoose from "mongoose";

const cableTvPackageSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      index: true,
    },
    tvProvider: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    tvProviderName: {
      type: String,
      default: "",
    },
    providerPackageCode: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    ourPrice: {
      type: Number,
      default: null,
      min: 0,
    },
    vendorPrice: {
      type: Number,
      default: null,
      min: 0,
    },
    fixedPrice: {
      type: Boolean,
      default: true,
    },
    isEnabled: {
      type: Boolean,
      default: false,
      index: true,
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

cableTvPackageSchema.index(
  { provider: 1, tvProvider: 1, providerPackageCode: 1 },
  { unique: true }
);

export default mongoose.model("CableTvPackage", cableTvPackageSchema);
