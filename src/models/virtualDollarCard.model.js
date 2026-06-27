import mongoose from "mongoose";

const virtualDollarCardSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    mapleradCustomerId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    providerCardId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    creationReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    brand: {
      type: String,
      enum: ["VISA", "MASTERCARD"],
      required: true,
    },
    currency: {
      type: String,
      enum: ["USD"],
      default: "USD",
    },
    type: {
      type: String,
      enum: ["VIRTUAL"],
      default: "VIRTUAL",
    },
    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "FROZEN", "FAILED", "TERMINATED"],
      default: "PENDING",
      index: true,
    },
    name: { type: String, trim: true },
    maskedPan: { type: String, trim: true },
    balance: { type: Number, default: 0, min: 0 },
    nextMaintenanceAt: { type: Date, default: null, index: true },
    lastMaintenanceAt: { type: Date, default: null },
    maintenancePastDue: { type: Boolean, default: false, index: true },
    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

virtualDollarCardSchema.index(
  { user: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["PENDING", "ACTIVE", "FROZEN"] },
    },
  }
);

export default mongoose.model("VirtualDollarCard", virtualDollarCardSchema);
