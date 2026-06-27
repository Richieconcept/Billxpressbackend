import mongoose from "mongoose";

const cardQuoteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    card: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VirtualDollarCard",
      default: null,
      index: true,
    },
    operation: {
      type: String,
      enum: ["creation", "funding", "withdrawal"],
      required: true,
      index: true,
    },
    brand: {
      type: String,
      enum: ["VISA", "MASTERCARD"],
      default: null,
    },
    providerQuoteReference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sourceCurrency: { type: String, required: true },
    sourceAmount: { type: Number, required: true, min: 1 },
    targetCurrency: { type: String, required: true },
    targetAmount: { type: Number, required: true, min: 1 },
    providerRate: { type: Number, required: true, min: 0 },
    fee: { type: Number, default: 0, min: 0 },
    exchangeMarkup: { type: Number, default: 0, min: 0 },
    walletDebit: { type: Number, default: 0, min: 0 },
    walletCredit: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "expired"],
      default: "pending",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    completedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    pricingSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model("CardQuote", cardQuoteSchema);
