import mongoose from "mongoose";

const mapleradCustomerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    customerId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    tier: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },

    status: {
      type: String,
      default: "PENDING",
      trim: true,
      index: true,
    },

    country: {
      type: String,
      default: "NG",
      uppercase: true,
      trim: true,
    },

    tier1SubmittedAt: {
      type: Date,
      default: null,
    },

    tier1ApprovedAt: {
      type: Date,
      default: null,
    },

    tier1AttemptStatus: {
      type: String,
      enum: ["idle", "processing", "failed", "successful"],
      default: "idle",
      index: true,
    },

    tier1LastAttemptAt: {
      type: Date,
      default: null,
    },

    tier1AttemptFingerprint: {
      type: String,
      default: null,
      select: false,
    },

    tier1FailureReason: {
      type: String,
      default: null,
    },

    tier1FeeTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },

    tier1FeeAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("MapleradCustomer", mapleradCustomerSchema);
