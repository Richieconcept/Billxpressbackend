import crypto from "crypto";
import ServicePurchaseLock from "../models/servicePurchaseLock.model.js";

const DEFAULT_LOCK_TTL_MS = 120000;

const getLockTtlMs = () => {
  const value = Number(process.env.SERVICE_PURCHASE_LOCK_TTL_MS || DEFAULT_LOCK_TTL_MS);

  return Number.isFinite(value) && value > 0
    ? Math.min(value, 10 * 60 * 1000)
    : DEFAULT_LOCK_TTL_MS;
};

const buildLockKey = ({ userId, service }) => `${userId}:${service}`;

const createLockError = (service) => {
  const error = new Error(
    `Another ${service} purchase is already processing. Please wait and try again.`
  );
  error.statusCode = 429;
  error.code = "purchase_already_processing";
  return error;
};

export const withServicePurchaseLock = async ({ userId, service, operation }) => {
  const key = buildLockKey({ userId, service });
  const owner = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + getLockTtlMs());
  let acquired = false;

  try {
    await ServicePurchaseLock.create({
      key,
      user: userId,
      service,
      owner,
      expiresAt,
    });
    acquired = true;
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }

    const now = new Date();
    const staleLock = await ServicePurchaseLock.findOneAndUpdate(
      {
        key,
        expiresAt: { $lte: now },
      },
      {
        $set: {
          user: userId,
          service,
          owner,
          expiresAt,
        },
      },
      { new: true }
    );

    if (!staleLock) {
      throw createLockError(service);
    }

    acquired = true;
  }

  try {
    return await operation();
  } finally {
    if (acquired) {
      await ServicePurchaseLock.deleteOne({ key, owner }).catch(() => {});
    }
  }
};
