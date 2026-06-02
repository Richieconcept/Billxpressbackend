import mongoose from "mongoose";

const fundingIntentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    provider: {
      type: String,
      default: "monnify",
      trim: true,
      index: true,
    },

    providerReference: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    paymentReference: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    fee: {
      type: Number,
      default: 0,
      min: 0,
    },

    amountToReceive: {
      type: Number,
      required: true,
      min: 1,
    },

    accountNumber: {
      type: String,
      required: true,
      trim: true,
    },

    accountName: {
      type: String,
      required: true,
      trim: true,
    },

    bankName: {
      type: String,
      required: true,
      trim: true,
    },

    bankCode: {
      type: String,
      trim: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["pending", "paid", "expired", "failed"],
      default: "pending",
      index: true,
    },

    paidAt: {
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

export default mongoose.model("FundingIntent", fundingIntentSchema);
