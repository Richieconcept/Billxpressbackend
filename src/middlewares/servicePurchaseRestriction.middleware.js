import ServicePurchaseRestriction from "../models/servicePurchaseRestriction.model.js";
import Transaction from "../models/transaction.model.js";

const DEFAULT_FAILURE_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_FIRST_FAILURE_THRESHOLD = 5;
const DEFAULT_REPEAT_FAILURE_THRESHOLD = 3;
const DEFAULT_FIRST_LOCK_MS = 60 * 60 * 1000;
const DEFAULT_REPEAT_LOCK_MS = 24 * 60 * 60 * 1000;

const getPositiveNumber = (name, fallback) => {
  const value = Number(process.env[name] || fallback);

  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getConfig = () => ({
  failureWindowMs: getPositiveNumber(
    "SERVICE_FAILURE_RESTRICTION_WINDOW_MS",
    DEFAULT_FAILURE_WINDOW_MS
  ),
  firstFailureThreshold: Math.max(
    1,
    Math.floor(
      getPositiveNumber(
        "SERVICE_FAILURE_RESTRICTION_FIRST_THRESHOLD",
        DEFAULT_FIRST_FAILURE_THRESHOLD
      )
    )
  ),
  repeatFailureThreshold: Math.max(
    1,
    Math.floor(
      getPositiveNumber(
        "SERVICE_FAILURE_RESTRICTION_REPEAT_THRESHOLD",
        DEFAULT_REPEAT_FAILURE_THRESHOLD
      )
    )
  ),
  firstLockMs: getPositiveNumber(
    "SERVICE_FAILURE_RESTRICTION_FIRST_LOCK_MS",
    DEFAULT_FIRST_LOCK_MS
  ),
  repeatLockMs: getPositiveNumber(
    "SERVICE_FAILURE_RESTRICTION_REPEAT_LOCK_MS",
    DEFAULT_REPEAT_LOCK_MS
  ),
});

const formatDuration = (ms) => {
  const hours = Math.round(ms / (60 * 60 * 1000));

  if (hours >= 1) {
    return `${hours}hr${hours === 1 ? "" : "s"}`;
  }

  const minutes = Math.max(1, Math.ceil(ms / (60 * 1000)));
  return `${minutes}min${minutes === 1 ? "" : "s"}`;
};

const getRestrictionResponse = (restriction) => {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((restriction.restrictedUntil.getTime() - Date.now()) / 1000)
  );
  const retryAfterHours = Math.max(1, Math.ceil(retryAfterSeconds / 3600));
  const retryAfterLabel =
    retryAfterHours >= 24 ? "24hrs" : `${retryAfterHours}hr`;

  return {
    message: `You've had many failed transactions. Kindly try again in ${retryAfterLabel} time.`,
    code: "SERVICE_PURCHASE_RESTRICTED",
    retryAfterSeconds,
    restrictedUntil: restriction.restrictedUntil,
  };
};

const findActiveRestriction = (userId) =>
  ServicePurchaseRestriction.findOne({
    user: userId,
    restrictedUntil: { $gt: new Date() },
  });

const countRecentFailedServicePurchases = async ({ userId, since }) =>
  Transaction.countDocuments({
    user: userId,
    type: "service_payment",
    direction: "debit",
    status: { $in: ["failed", "reversed"] },
    createdAt: { $gte: since },
  });

const maybeRestrictUser = async (userId) => {
  const config = getConfig();
  const now = new Date();
  const since = new Date(now.getTime() - config.failureWindowMs);
  const existing = await ServicePurchaseRestriction.findOne({ user: userId });

  if (existing?.restrictedUntil > now) {
    return existing;
  }

  const threshold =
    existing?.strikeCount > 0
      ? config.repeatFailureThreshold
      : config.firstFailureThreshold;
  const failureCount = await countRecentFailedServicePurchases({ userId, since });

  if (failureCount < threshold) {
    return null;
  }

  const lockMs = existing?.strikeCount > 0 ? config.repeatLockMs : config.firstLockMs;
  const restrictedUntil = new Date(now.getTime() + lockMs);
  const reason = `${failureCount} failed service purchases in ${formatDuration(
    config.failureWindowMs
  )}`;

  return ServicePurchaseRestriction.findOneAndUpdate(
    {
      user: userId,
      $or: [
        { restrictedUntil: { $lte: now } },
        { restrictedUntil: { $exists: false } },
      ],
    },
    {
      $set: {
        restrictedUntil,
        lastFailureCount: failureCount,
        lastFailureWindowStartedAt: since,
        lastRestrictedAt: now,
        reason,
      },
      $inc: { strikeCount: 1 },
      $setOnInsert: { user: userId },
    },
    {
      new: true,
      upsert: true,
    }
  );
};

export const enforceServicePurchaseRestriction = async (req, res, next) => {
  const userId = req.user?._id;

  if (!userId) {
    return next();
  }

  const activeRestriction = await findActiveRestriction(userId);

  if (activeRestriction) {
    const response = getRestrictionResponse(activeRestriction);
    res.set("Retry-After", String(response.retryAfterSeconds));

    return res.status(429).json(response);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.json = originalJson;

    if (res.statusCode >= 400) {
      maybeRestrictUser(userId).catch((error) => {
        console.error("Could not evaluate service purchase restriction", error);
      });
    }

    return originalJson(body);
  };

  return next();
};
