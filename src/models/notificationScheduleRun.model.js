import mongoose from "mongoose";
const schema = new mongoose.Schema({
  slot: { type: String, required: true, unique: true },
  status: { type: String, enum: ["running", "completed", "failed"], default: "running" },
  requested: { type: Number, default: 0 },
  created: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  error: { type: String, default: null },
}, { timestamps: true });
export default mongoose.model("NotificationScheduleRun", schema);
