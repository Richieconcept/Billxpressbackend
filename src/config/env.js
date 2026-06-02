const baseRequiredEnv = ["MONGO_URI", "JWT_SECRET"];
const productionRequiredEnv = [
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "CLIENT_URL",
];
const pocketFiEnv = ["POCKETFI_API_KEY", "POCKETFI_SECRET_KEY", "POCKETFI_BUSINESS_ID"];
const monnifyEnv = ["MONNIFY_API_KEY", "MONNIFY_SECRET_KEY", "MONNIFY_CONTRACT_CODE"];

export const validateEnv = () => {
  const requiredEnv = [...baseRequiredEnv];

  if (process.env.NODE_ENV === "production") {
    requiredEnv.push(...productionRequiredEnv);
  }

  const missing = requiredEnv.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (process.env.NODE_ENV !== "production") {
    const missingEmailEnv = productionRequiredEnv.filter((key) => !process.env[key]);

    if (missingEmailEnv.length > 0) {
      console.warn(
        `Email delivery is not fully configured. Missing: ${missingEmailEnv.join(", ")}`
      );
    }

    const missingPocketFiEnv = pocketFiEnv.filter((key) => !process.env[key]);

    if (missingPocketFiEnv.length > 0) {
      console.warn(
        `PocketFi integration is not fully configured. Missing: ${missingPocketFiEnv.join(", ")}`
      );
    }

    const missingMonnifyEnv = monnifyEnv.filter((key) => !process.env[key]);

    if (missingMonnifyEnv.length > 0) {
      console.warn(
        `Monnify one-time funding is not fully configured. Missing: ${missingMonnifyEnv.join(", ")}`
      );
    }
  }
};
