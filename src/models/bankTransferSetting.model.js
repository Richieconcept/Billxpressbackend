import mongoose from "mongoose";

const bankTransferSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "maplerad_ngn_payout",
      unique: true,
      index: true,
    },
    flatFee: {
      type: Number,
      default: 2500,
      min: 0,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  "BankTransferSetting",
  bankTransferSettingSchema
);
