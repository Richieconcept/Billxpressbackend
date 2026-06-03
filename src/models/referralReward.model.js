import mongoose from "mongoose";

const referralRewardSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    referredUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    trigger: {
      type: String,
      enum: ["first_deposit"],
      default: "first_deposit",
      required: true,
      index: true,
    },

    qualifyingAmount: {
      type: Number,
      required: true,
      min: 1,
    },

    rewardPercent: {
      type: Number,
      required: true,
      min: 0,
    },

    rewardAmount: {
      type: Number,
      required: true,
      min: 1,
    },

    status: {
      type: String,
      enum: ["processing", "successful", "failed"],
      default: "processing",
      index: true,
    },

    fundingTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },

    rewardTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },

    failureReason: {
      type: String,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

referralRewardSchema.index(
  { referredUser: 1, trigger: 1 },
  { unique: true }
);

export default mongoose.model("ReferralReward", referralRewardSchema);
