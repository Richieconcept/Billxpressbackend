import User from "../models/user.model.js";
import Notification from "../models/notification.model.js";
import Transaction from "../models/transaction.model.js";
import {
  createNotificationsForUsers,
  serializeNotification,
} from "../services/notification.service.js";
import { getDataProvider } from "../services/dataProviders/index.js";
import { generateApiKey } from "../utils/generateApiKey.js";
import { sanitizeUser } from "../utils/sanitizeUser.js";

const generateUniqueApiKey = async () => {
  let apiKey = generateApiKey();

  while (await User.exists({ apiKey })) {
    apiKey = generateApiKey();
  }

  return apiKey;
};

const sendAdminError = (res, publicMessage, error) => {
  res.status(500).json({
    message: publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

const naira = (value) => Number((Number(value) || 0).toFixed(2));

const percentage = (value, total) => {
  if (!total || total <= 0) {
    return 0;
  }

  return Number(((value / total) * 100).toFixed(2));
};

const createMetricBucket = () => ({
  earned: 0,
  costPrice: 0,
  sellingPrice: 0,
  profit: 0,
  lossAmount: 0,
  lostProfit: 0,
  successfulCount: 0,
  failedCount: 0,
  reversedCount: 0,
  totalCount: 0,
});

const finalizeMetricBucket = (bucket) => {
  const earned = naira(bucket.earned);
  const costPrice = naira(bucket.costPrice);
  const sellingPrice = naira(bucket.sellingPrice);
  const profit = naira(bucket.profit);
  const lossAmount = naira(bucket.lossAmount);
  const lostProfit = naira(bucket.lostProfit);

  return {
    earned,
    revenue: earned,
    costPrice,
    sellingPrice,
    profit,
    lossAmount,
    lostProfit,
    lossPercentage: percentage(lossAmount, earned + lossAmount),
    profitMarginPercentage: percentage(profit, earned),
    successfulCount: bucket.successfulCount,
    failedCount: bucket.failedCount,
    reversedCount: bucket.reversedCount,
    totalCount: bucket.totalCount,
    averageSellingPrice: bucket.successfulCount
      ? naira(sellingPrice / bucket.successfulCount)
      : 0,
  };
};

const getStartOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const addMonths = (date, months) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const getStartOfWeek = (date) => {
  const start = getStartOfDay(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(start, diff);
};

const getStartOfMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

const padDatePart = (value) => String(value).padStart(2, "0");

const formatDayKey = (date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate()
  )}`;

const formatMonthKey = (date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}`;

const getPeriodKey = (date, period) => {
  if (period === "weekly") {
    return formatDayKey(getStartOfWeek(date));
  }

  if (period === "monthly") {
    return formatMonthKey(getStartOfMonth(date));
  }

  return formatDayKey(getStartOfDay(date));
};

const makeSeries = ({ transactions, period, count, now }) => {
  const currentStart =
    period === "monthly"
      ? getStartOfMonth(now)
      : period === "weekly"
        ? getStartOfWeek(now)
        : getStartOfDay(now);
  const buckets = [];
  const byKey = new Map();

  for (let index = count - 1; index >= 0; index -= 1) {
    const start =
      period === "monthly"
        ? addMonths(currentStart, -index)
        : addDays(currentStart, -index * (period === "weekly" ? 7 : 1));
    const key = getPeriodKey(start, period);
    const bucket = createMetricBucket();

    buckets.push({
      period: key,
      startDate: start.toISOString(),
      ...bucket,
    });
    byKey.set(key, bucket);
  }

  transactions.forEach((transaction) => {
    const key = getPeriodKey(transaction.createdAt, period);
    const bucket = byKey.get(key);

    if (bucket) {
      addTransactionToBucket(bucket, transaction);
    }
  });

  return buckets.map(({ period: key, startDate }) => ({
    period: key,
    startDate,
    ...finalizeMetricBucket(byKey.get(key)),
  }));
};

const getNumber = (...values) => {
  const value = values.find((item) => Number.isFinite(Number(item)));
  return Number(value) || 0;
};

const normalizeDashboardTransaction = (transaction) => {
  const metadata = transaction.metadata || {};
  const sellingPrice = getNumber(metadata.sellingPrice, transaction.amount / 100);
  const costPrice = getNumber(metadata.costPrice, metadata.amount, sellingPrice);
  const profit = getNumber(metadata.profit, sellingPrice - costPrice);

  return {
    createdAt: transaction.createdAt,
    status: transaction.status,
    service: metadata.service || "unknown",
    sellingPrice,
    costPrice,
    profit: Math.max(0, profit),
  };
};

const addTransactionToBucket = (bucket, transaction) => {
  bucket.totalCount += 1;

  if (transaction.status === "successful") {
    bucket.earned += transaction.sellingPrice;
    bucket.sellingPrice += transaction.sellingPrice;
    bucket.costPrice += transaction.costPrice;
    bucket.profit += transaction.profit;
    bucket.successfulCount += 1;
    return;
  }

  if (transaction.status === "reversed") {
    bucket.reversedCount += 1;
  } else if (transaction.status === "failed") {
    bucket.failedCount += 1;
  }

  bucket.lossAmount += transaction.sellingPrice;
  bucket.lostProfit += transaction.profit;
};

const filterTransactionsFrom = (transactions, startDate) =>
  transactions.filter((transaction) => transaction.createdAt >= startDate);

const summarizeTransactions = (transactions) => {
  const bucket = createMetricBucket();

  transactions.forEach((transaction) => addTransactionToBucket(bucket, transaction));

  return finalizeMetricBucket(bucket);
};

const summarizeByService = (transactions) => {
  const buckets = new Map();

  transactions.forEach((transaction) => {
    if (!buckets.has(transaction.service)) {
      buckets.set(transaction.service, createMetricBucket());
    }

    addTransactionToBucket(buckets.get(transaction.service), transaction);
  });

  return Array.from(buckets.entries())
    .map(([service, bucket]) => ({
      service,
      ...finalizeMetricBucket(bucket),
    }))
    .sort((a, b) => b.earned - a.earned);
};

const getProviderBalanceBestEffort = async (providerName) => {
  try {
    const provider = getDataProvider(providerName);

    if (typeof provider.fetchBalance !== "function") {
      return {
        provider: providerName,
        available: false,
        error: "Provider balance is not supported",
      };
    }

    const balance = await provider.fetchBalance();

    return {
      ...balance,
      available: true,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      provider: providerName,
      available: false,
      error: error.message,
      checkedAt: new Date().toISOString(),
    };
  }
};

export const getAdminDashboardEarnings = async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = getStartOfDay(now);
    const startOfWeek = getStartOfWeek(now);
    const startOfMonth = getStartOfMonth(now);
    const oldestSeriesStart = addMonths(startOfMonth, -11);
    const transactions = (
      await Transaction.find({
        type: "service_payment",
        direction: "debit",
        status: { $in: ["successful", "failed", "reversed"] },
      })
        .select("amount status metadata createdAt")
        .lean()
    ).map(normalizeDashboardTransaction);
    const seriesTransactions = filterTransactionsFrom(
      transactions,
      oldestSeriesStart
    );
    const providerBalances = {
      smeapi: await getProviderBalanceBestEffort("smeapi"),
    };

    res.json({
      currency: "NGN",
      generatedAt: now.toISOString(),
      providerBalances,
      summary: {
        allTime: summarizeTransactions(transactions),
        today: summarizeTransactions(
          filterTransactionsFrom(transactions, startOfToday)
        ),
        thisWeek: summarizeTransactions(
          filterTransactionsFrom(transactions, startOfWeek)
        ),
        thisMonth: summarizeTransactions(
          filterTransactionsFrom(transactions, startOfMonth)
        ),
      },
      services: summarizeByService(transactions),
      series: {
        daily: makeSeries({
          transactions: seriesTransactions,
          period: "daily",
          count: 7,
          now,
        }),
        weekly: makeSeries({
          transactions: seriesTransactions,
          period: "weekly",
          count: 8,
          now,
        }),
        monthly: makeSeries({
          transactions: seriesTransactions,
          period: "monthly",
          count: 12,
          now,
        }),
      },
    });
  } catch (error) {
    sendAdminError(res, "Could not fetch dashboard earnings", error);
  }
};

export const listAdmins = async (req, res) => {
  try {
    const admins = await User.find({ role: "admin" })
      .select("-password -transactionPin -emailVerificationOtp")
      .sort({ createdAt: -1 });

    res.json({
      admins: admins.map((admin) => sanitizeUser(admin)),
    });
  } catch (error) {
    sendAdminError(res, "Could not fetch admins", error);
  }
};

const promoteUserToAdmin = async (user) => {
  user.role = "admin";
  user.apiKey = undefined;
  user.discountRate = 0;
  user.isVendorActive = false;
  user.vendorApprovedAt = undefined;

  await user.save();

  return user;
};

export const bootstrapFirstAdmin = async (req, res) => {
  try {
    const setupSecret = process.env.ADMIN_SETUP_SECRET;
    const providedSecret = req.headers["x-admin-setup-secret"];

    if (!setupSecret) {
      return res.status(403).json({
        message: "Admin setup is not enabled",
      });
    }

    if (!providedSecret || providedSecret !== setupSecret) {
      return res.status(403).json({
        message: "Invalid admin setup secret",
      });
    }

    const activeAdminCount = await User.countDocuments({
      role: "admin",
      isActive: true,
    });

    if (activeAdminCount > 0) {
      return res.status(400).json({
        message: "An active admin already exists",
      });
    }

    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        message: "Inactive users cannot be made admin",
      });
    }

    await promoteUserToAdmin(user);

    res.json({
      message: "First admin created successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendAdminError(res, "Could not create first admin", error);
  }
};

export const makeAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        message: "Inactive users cannot be made admin",
      });
    }

    if (user.role === "admin") {
      return res.status(400).json({
        message: "User is already an admin",
      });
    }

    await promoteUserToAdmin(user);

    res.json({
      message: "User upgraded to admin successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendAdminError(res, "Could not upgrade user to admin", error);
  }
};

export const removeAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({
        message: "You cannot remove your own admin role",
      });
    }

    if (user.role !== "admin") {
      return res.status(400).json({
        message: "User is not an admin",
      });
    }

    const adminCount = await User.countDocuments({
      role: "admin",
      isActive: true,
    });

    if (adminCount <= 1) {
      return res.status(400).json({
        message: "At least one active admin must remain",
      });
    }

    user.role = "user";

    await user.save();

    res.json({
      message: "Admin role removed successfully",
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendAdminError(res, "Could not remove admin role", error);
  }
};

export const makeVendor = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (user.role === "vendor") {
      return res.status(400).json({
        message: "User is already a vendor",
      });
    }

    if (user.role === "admin") {
      return res.status(400).json({
        message: "Admins cannot be upgraded to vendor",
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        message: "Inactive users cannot be made vendor",
      });
    }

    user.role = "vendor";
    user.apiKey = await generateUniqueApiKey();
    user.discountRate = 0.2;
    user.isVendorActive = true;
    user.vendorApprovedAt = new Date();

    await user.save();

    res.json({
      message: "User upgraded to vendor successfully",
      user: sanitizeUser(user),
      apiKey: user.apiKey,
    });
  } catch (error) {
    sendAdminError(res, "Could not upgrade user to vendor", error);
  }
};

export const createAdminNotification = async (req, res) => {
  try {
    const {
      target = "user",
      userId,
      title,
      message,
      type = "admin_announcement",
      channel = "in_app",
      priority = "normal",
      data = {},
      expiresAt,
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        message: "Title and message are required",
      });
    }

    let userIds = [];

    if (target === "user") {
      if (!userId) {
        return res.status(400).json({
          message: "userId is required when target is user",
        });
      }

      const user = await User.findById(userId);

      if (!user || !user.isActive) {
        return res.status(404).json({
          message: "Target user not found or inactive",
        });
      }

      userIds = [user._id];
    } else if (target === "all") {
      const users = await User.find({ isActive: true }).select("_id");
      userIds = users.map((user) => user._id);
    } else {
      return res.status(400).json({
        message: "target must be user or all",
      });
    }

    const results = await createNotificationsForUsers({
      userIds,
      title,
      message,
      type,
      channel,
      priority,
      data,
      createdBy: req.user._id,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });
    const successful = results.filter((result) => !result.error);
    const failed = results.filter((result) => result.error);

    res.status(201).json({
      message: "Notification created successfully",
      target,
      requestedCount: userIds.length,
      createdCount: successful.length,
      failedCount: failed.length,
      notifications: successful.slice(0, 20).map((notification) =>
        serializeNotification(notification)
      ),
      errors: failed,
    });
  } catch (error) {
    sendAdminError(res, "Could not create notification", error);
  }
};

export const listAdminNotifications = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const query = {};

    if (req.query.type) {
      query.type = req.query.type;
    }

    if (req.query.userId) {
      query.user = req.query.userId;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate("user", "firstName lastName username email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments(query),
    ]);

    res.json({
      notifications: notifications.map((notification) => ({
        ...serializeNotification(notification),
        user: notification.user,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendAdminError(res, "Could not fetch notifications", error);
  }
};
