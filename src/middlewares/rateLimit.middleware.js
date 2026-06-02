const buckets = new Map();

const getClientIp = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "unknown";
};

const getRequestKey = (req, keyFields = []) => {
  const parts = [getClientIp(req)];

  for (const field of keyFields) {
    const value = req.body?.[field];

    if (typeof value === "string" && value.trim()) {
      parts.push(value.trim().toLowerCase());
    }
  }

  return parts.join(":");
};

const cleanupExpiredBuckets = () => {
  const now = Date.now();

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
};

export const rateLimit = ({
  windowMs,
  max,
  message = "Too many requests, please try again later",
  keyFields = [],
}) => {
  if (!windowMs || !max) {
    throw new Error("rateLimit requires windowMs and max");
  }

  return (req, res, next) => {
    cleanupExpiredBuckets();

    const now = Date.now();
    const key = `${req.method}:${req.originalUrl}:${getRequestKey(req, keyFields)}`;
    const currentBucket = buckets.get(key);

    if (!currentBucket || currentBucket.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });

      return next();
    }

    currentBucket.count += 1;

    if (currentBucket.count > max) {
      const retryAfterSeconds = Math.ceil((currentBucket.resetAt - now) / 1000);

      res.set("Retry-After", String(retryAfterSeconds));

      return res.status(429).json({
        message,
        retryAfterSeconds,
      });
    }

    return next();
  };
};
