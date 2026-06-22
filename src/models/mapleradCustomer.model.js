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
