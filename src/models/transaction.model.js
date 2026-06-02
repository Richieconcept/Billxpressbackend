import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "funding",
        "credit",
        "debit",
        "transfer",
        "referral_earning",
        "referral_redeem",
        "service_payment",
        "reversal",
      ],
      required: true,
    },

    walletType: {
      type: String,
      enum: ["main", "referral"],
      required: true,
    },

    direction: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },

    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
      trim: true,
    },

    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    provider: {
      type: String,
      default: "billxpress",
      trim: true,
    },

    providerReference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["pending", "successful", "failed", "reversed"],
      default: "successful",
      index: true,
    },

    narration: {
      type: String,
      trim: true,
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

export default mongoose.model("Transaction", transactionSchema);
