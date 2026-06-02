import crypto from "crypto";
import AuthSession from "../models/authSession.model.js";

const REFRESH_TOKEN_BYTES = 48;
const DEFAULT_REFRESH_DAYS = 90;

const getRefreshExpiryDate = () => {
  const days = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || DEFAULT_REFRESH_DAYS);
  const safeDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_REFRESH_DAYS;

  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000);
};

const generateRefreshToken = () =>
  crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

export const serializeAuthSession = (session) => ({
  id: session._id,
  deviceName: session.deviceName,
  expiresAt: session.expiresAt,
  lastUsedAt: session.lastUsedAt,
  createdAt: session.createdAt,
});

export const createAuthSession = async ({ user, deviceName, userAgent, ipAddress }) => {
  const refreshToken = generateRefreshToken();
  const session = await AuthSession.create({
    user: user._id,
    refreshTokenHash: hashRefreshToken(refreshToken),
    deviceName: deviceName || null,
    userAgent: userAgent || null,
    ipAddress: ipAddress || null,
    expiresAt: getRefreshExpiryDate(),
  });

  return {
    refreshToken,
    session,
  };
};

export const rotateAuthSession = async (refreshToken) => {
  if (!refreshToken) {
    const error = new Error("Refresh token is required");
    error.statusCode = 400;
    throw error;
  }

  const session = await AuthSession.findOne({
    refreshTokenHash: hashRefreshToken(refreshToken),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).populate("user");

  if (!session || !session.user || !session.user.isActive) {
    const error = new Error("Invalid or expired refresh token");
    error.statusCode = 401;
    throw error;
  }

  const nextRefreshToken = generateRefreshToken();
  session.refreshTokenHash = hashRefreshToken(nextRefreshToken);
  session.lastUsedAt = new Date();
  session.expiresAt = getRefreshExpiryDate();
  await session.save();

  return {
    refreshToken: nextRefreshToken,
    session,
    user: session.user,
  };
};

export const revokeAuthSession = async (refreshToken) => {
  if (!refreshToken) {
    const error = new Error("Refresh token is required");
    error.statusCode = 400;
    throw error;
  }

  const session = await AuthSession.findOne({
    refreshTokenHash: hashRefreshToken(refreshToken),
    revokedAt: null,
  });

  if (session) {
    session.revokedAt = new Date();
    await session.save();
  }

  return session;
};
