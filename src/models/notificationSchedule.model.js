import mongoose from "mongoose";
const scheduleSchema = new mongoose.Schema({
  key: { type: String, default: "daily", unique: true, immutable: true },
  enabled: { type: Boolean, default: false },
  title: { type: String, default: "", trim: true, maxlength: 120 },
  message: { type: String, default: "", trim: true, maxlength: 1000 },
  target: { type: String, enum: ["all", "user"], default: "all" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  channel: { type: String, enum: ["in_app", "push", "email", "both", "all"], default: "in_app" },
  priority: { type: String, enum: ["low", "normal", "high"], default: "normal" },
  morning: { type: String, default: "08:00" },
  evening: { type: String, default: "18:00" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
export default mongoose.model("NotificationSchedule", scheduleSchema);
