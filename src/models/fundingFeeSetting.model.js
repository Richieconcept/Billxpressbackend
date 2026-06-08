import mongoose from "mongoose";

const fundingFeeSettingSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["pocketfi", "monnify"],
      required: true,
      unique: true,
      index: true,
    },

    percent: {
      type: Number,
      default: 1,
      min: 0,
      max: 100,
    },

    flat: {
      type: Number,
      default: 0,
      min: 0,
    },

    creditPolicy: {
      type: String,
      enum: ["gross"],
      default: "gross",
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

export default mongoose.model("FundingFeeSetting", fundingFeeSettingSchema);
