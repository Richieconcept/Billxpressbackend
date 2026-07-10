import mongoose from "mongoose";

const feeSchema = new mongoose.Schema(
  {
    percent: { type: Number, default: 0, min: 0, max: 100 },
    flat: { type: Number, default: 0, min: 0 },
    thresholdAmount: { type: Number, default: 0, min: 0 },
    belowThresholdFlat: { type: Number, default: 0, min: 0 },
    aboveThresholdPercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false }
);

const cardSettingSchema = new mongoose.Schema(
  {
    service: {
      type: String,
      default: "virtual_dollar_card",
      unique: true,
      immutable: true,
    },
    isEnabled: { type: Boolean, default: true },
    allowedBrands: {
      type: [String],
      enum: ["VISA", "MASTERCARD"],
      default: ["VISA", "MASTERCARD"],
    },
    defaultBrand: {
      type: String,
      enum: ["VISA", "MASTERCARD"],
      default: "VISA",
    },
    creationFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    creationFeeUsd: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    providerCreationFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    fundingFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    providerFundingFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    withdrawalFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    providerWithdrawalFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    crossBorderFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    providerCrossBorderFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    chargebackFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    providerChargebackFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    declineFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    providerDeclineFee: {
      type: feeSchema,
      default: () => ({ percent: 0, flat: 0 }),
    },
    fundingExchangeMarkupPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    withdrawalExchangeMarkupPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    monthlyMaintenanceFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    maintenanceGracePeriodDays: {
      type: Number,
      default: 3,
      min: 0,
      max: 31,
    },
    freezeOnMaintenanceFailure: {
      type: Boolean,
      default: true,
    },
    minimumFundingAmount: {
      type: Number,
      default: 100000,
      min: 1,
    },
    maximumFundingAmount: {
      type: Number,
      default: 100000000,
      min: 1,
    },
    minimumWithdrawalAmount: {
      type: Number,
      default: 100,
      min: 1,
    },
    quoteTtlSeconds: {
      type: Number,
      default: 300,
      min: 30,
      max: 1800,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("CardSetting", cardSettingSchema);
