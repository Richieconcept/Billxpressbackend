import NotificationSchedule from "../models/notificationSchedule.model.js";
import NotificationScheduleRun from "../models/notificationScheduleRun.model.js";
import User from "../models/user.model.js";
import { validateSchedule } from "../services/notificationScheduler.service.js";

export const getNotificationSchedule = async (req, res) => {
  try {
    const schedule = await NotificationSchedule.findOne({ key: "daily" }).lean();
    const runs = await NotificationScheduleRun.find().sort({ createdAt: -1 }).limit(10).lean();
    res.json({ schedule: schedule || { enabled: false, title: "", message: "", target: "all", userId: null, channel: "in_app", priority: "normal", morning: "08:00", evening: "18:00" }, runs });
  } catch (error) {
    res.status(500).json({ message: "Could not load notification schedule" });
  }
};
export const putNotificationSchedule = async (req, res) => {
  try {
    const values = validateSchedule(req.body);
    if (values.target === "user" && !await User.exists({ _id: values.userId, isActive: true })) return res.status(400).json({ message: "Selected user was not found or is inactive" });
    const schedule = await NotificationSchedule.findOneAndUpdate(
      { key: "daily" }, { $set: { ...values, updatedBy: req.user._id } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    res.json({ schedule });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Could not save notification schedule" });
  }
};
