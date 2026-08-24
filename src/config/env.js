const baseRequiredEnv = ["MONGO_URI", "JWT_SECRET"];
const emailEnv = [
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
];
const frontendEnv = ["CLIENT_URL"];
const pocketFiEnv = ["POCKETFI_API_KEY", "POCKETFI_SECRET_KEY", "POCKETFI_BUSINESS_ID"];
const monnifyEnv = ["MONNIFY_API_KEY", "MONNIFY_SECRET_KEY", "MONNIFY_CONTRACT_CODE"];
const mapleradEnv = [
  "MAPLERAD_SECRET_KEY",
  "MAPLERAD_WEBHOOK_SECRET",
];
const flutterwaveEnv = ["FLUTTERWAVE_SECRET_KEY"];
const vtpassEnv = ["VTPASS_API_KEY", "VTPASS_SECRET_KEY"];
const exosupplierEnv = ["EXOSUPPLIER_API_KEY"];

export const validateEnv = () => {
  const requiredEnv = [...baseRequiredEnv];

  const missing = requiredEnv.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const warnIfMissing = (label, keys) => {
    const missingKeys = keys.filter((key) => !process.env[key]);

    if (missingKeys.length > 0) {
      console.warn(`${label} is not fully configured. Missing: ${missingKeys.join(", ")}`);
    }
  };

  warnIfMissing("Frontend redirects", frontendEnv);
  warnIfMissing("Email delivery", emailEnv);
  warnIfMissing("PocketFi integration", pocketFiEnv);
  warnIfMissing("Monnify one-time funding", monnifyEnv);
  warnIfMissing("Maplerad one-time funding", mapleradEnv);
  warnIfMissing("Flutterwave one-time funding", flutterwaveEnv);
  warnIfMissing("VTpass services", vtpassEnv);
  warnIfMissing("Exosupplier social growth", exosupplierEnv);
};
