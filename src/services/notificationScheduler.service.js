import mongoose from "mongoose";
import NotificationSchedule from "../models/notificationSchedule.model.js";
import NotificationScheduleRun from "../models/notificationScheduleRun.model.js";
import User from "../models/user.model.js";
import { createNotificationsForUsers } from "./notification.service.js";

export const validateSchedule = (body) => {
  const value = {
    enabled: body.enabled === true,
    title: String(body.title || "").trim(),
    message: String(body.message || "").trim(),
    target: body.target || "all",
    userId: body.target === "user" ? body.userId : null,
    channel: body.channel || "in_app",
    priority: body.priority || "normal",
    morning: String(body.morning || ""),
    evening: String(body.evening || ""),
  };
  if (typeof body.enabled !== "boolean" || value.title.length > 120 || value.message.length > 1000 ||
    !["all", "user"].includes(value.target) || !["in_app", "push", "email", "both", "all"].includes(value.channel) ||
    !["low", "normal", "high"].includes(value.priority) ||
    !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value.morning) ||
    !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value.evening) ||
    value.morning >= value.evening ||
    (value.target === "user" && !mongoose.isValidObjectId(value.userId)) ||
    (value.enabled && (!value.title || !value.message))) {
    const error = new Error("Enter valid message, audience, channel and two different times (morning before evening).");
    error.statusCode = 400;
    throw error;
  }
  return value;
};

export const dueSlots = (schedule, now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const date = parts.year + "-" + parts.month + "-" + parts.day;
  return ["morning", "evening"].filter((slot) => {
    const [hour, min] = schedule[slot].split(":").map(Number);
    const elapsed = minute - (hour * 60 + min);
    return elapsed >= 0 && elapsed < 10;
  }).map((slot) => ({ slot, key: date + ":" + slot }));
};

export const processScheduledNotifications = async (now = new Date()) => {
  const schedule = await NotificationSchedule.findOne({ key: "daily", enabled: true }).lean();
  if (!schedule) return;
  await NotificationScheduleRun.init();
  for (const due of dueSlots(schedule, now)) {
    let run;
    try {
      run = await NotificationScheduleRun.create({ slot: due.key });
    } catch (error) {
      if (error.code === 11000) continue;
      throw error;
    }
    try {
      const query = schedule.target === "user" ? { _id: schedule.userId, isActive: true } : { isActive: true };
      const users = await User.find(query).select("_id").lean();
      const results = await createNotificationsForUsers({
        userIds: users.map((u) => u._id), title: schedule.title, message: schedule.message,
        type: "admin_announcement", channel: schedule.channel, priority: schedule.priority,
        createdBy: schedule.updatedBy, data: { scheduleSlot: due.key },
      });
      run.requested = users.length;
      run.failed = results.filter((r) => r.error).length;
      run.created = results.length - run.failed;
      run.status = "completed";
    } catch (error) {
      run.status = "failed";
      run.error = error.message;
    }
    await run.save();
  }
};

export const startNotificationScheduler = () => {
  let running = false;
  const tick = async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try { await processScheduledNotifications(); }
    catch (error) { console.error("Scheduled notification processing failed:", error.message); }
    finally { running = false; }
  };
  void tick();
  return setInterval(tick, 60_000);
};
