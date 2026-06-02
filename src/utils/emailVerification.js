import crypto from "crypto";

export const createEmailVerificationOtp = () => {
  const otp = crypto.randomInt(0, 100000).toString().padStart(5, "0");
  const hashedOtp = hashEmailVerificationOtp(otp);
  const expires = new Date(Date.now() + 1000 * 60 * 10);

  return {
    otp,
    hashedOtp,
    expires,
  };
};

export const hashEmailVerificationOtp = (otp) => {
  return crypto.createHash("sha256").update(String(otp)).digest("hex");
};

export const canResendEmailVerificationOtp = (lastSentAt) => {
  if (!lastSentAt) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  }

  const waitSeconds = 60;
  const elapsedSeconds = Math.floor((Date.now() - new Date(lastSentAt).getTime()) / 1000);
  const retryAfterSeconds = Math.max(waitSeconds - elapsedSeconds, 0);

  return {
    allowed: retryAfterSeconds === 0,
    retryAfterSeconds,
  };
};
