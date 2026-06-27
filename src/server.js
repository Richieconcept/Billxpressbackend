import dotenv from "dotenv";
import app from "./app.js";
import connectDB from "./config/db.js";
import { validateEnv } from "./config/env.js";
import { processDueCardMaintenanceFees } from "./services/card.service.js";

dotenv.config();

validateEnv();

// connect database
connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("🚀 Server Started Successfully");
  console.log(`🌐 Running on: http://localhost:${PORT}`);
});

const maintenanceIntervalMs = Number(
  process.env.CARD_MAINTENANCE_INTERVAL_MS || 60 * 60 * 1000
);

setTimeout(() => {
  processDueCardMaintenanceFees().catch((error) => {
    console.error("Card maintenance processing failed:", error.message);
  });

  setInterval(() => {
    processDueCardMaintenanceFees().catch((error) => {
      console.error("Card maintenance processing failed:", error.message);
    });
  }, maintenanceIntervalMs);
}, 30_000);
