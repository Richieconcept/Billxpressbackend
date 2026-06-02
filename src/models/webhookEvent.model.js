import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    signature: {
      type: String,
      trim: true,
    },

    eventReference: {
      type: String,
      sparse: true,
      index: true,
    },

    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    processed: {
      type: Boolean,
      default: false,
      index: true,
    },

    processingError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("WebhookEvent", webhookEventSchema);
