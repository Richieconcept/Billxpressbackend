import mongoose from "mongoose";

const virtualAccountSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    provider: {
      type: String,
      default: "pocketfi",
      trim: true,
    },

    businessId: {
      type: String,
      required: true,
      trim: true,
    },

    bankName: {
      type: String,
      trim: true,
    },

    accountNumber: {
      type: String,
      trim: true,
      index: true,
    },

    accountName: {
      type: String,
      trim: true,
    },

    displayName: {
      type: String,
      trim: true,
    },

    accounts: [
      {
        bankName: {
          type: String,
          required: true,
          trim: true,
        },
        provider: {
          type: String,
          required: true,
          trim: true,
        },
        providerAccountId: {
          type: String,
          trim: true,
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
        displayName: {
          type: String,
          trim: true,
        },
        status: {
          type: String,
          enum: ["active", "inactive"],
          default: "active",
        },
        providerResponse: {
          type: mongoose.Schema.Types.Mixed,
          default: {},
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    providerErrors: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },

    status: {
      type: String,
      enum: ["active", "inactive", "pending"],
      default: "pending",
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

export default mongoose.model("VirtualAccount", virtualAccountSchema);
