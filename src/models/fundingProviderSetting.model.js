import mongoose from "mongoose";

const fundingProviderSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      enum: ["one_time_funding"],
      required: true,
      unique: true,
      index: true,
    },

    provider: {
      type: String,
      enum: ["monnify", "maplerad"],
      required: true,
      default: "maplerad",
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

export default mongoose.model(
  "FundingProviderSetting",
  fundingProviderSettingSchema
);
