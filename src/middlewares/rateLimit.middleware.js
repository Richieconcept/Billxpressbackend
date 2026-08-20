const buckets = new Map();

const getClientIp = (req) => {
  return req.ip || req.socket?.remoteAddress || "unknown";
};

const getRequestPath = (req) => {
  const baseUrl = req.baseUrl || "";
  const path = req.path || String(req.originalUrl || "").split("?")[0] || "/";

  return `${baseUrl}${path}`;
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
  keyGenerator,
  code,
}) => {
  if (!windowMs || !max) {
    throw new Error("rateLimit requires windowMs and max");
  }

  return (req, res, next) => {
    cleanupExpiredBuckets();

    const now = Date.now();
    const requestKey =
      typeof keyGenerator === "function"
        ? keyGenerator(req)
        : getRequestKey(req, keyFields);
    const key = `${req.method}:${getRequestPath(req)}:${requestKey}`;
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
        success: code ? false : undefined,
        message,
        code,
        retryAfterSeconds,
      });
    }

    return next();
  };
};

export const authenticatedRateLimit = (options) =>
  rateLimit({
    ...options,
    keyGenerator: (req) => {
      if (req.user?._id) {
        return `user:${req.user._id}`;
      }

      return getRequestKey(req, options.keyFields || []);
    },
  });
