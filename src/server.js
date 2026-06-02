import dotenv from "dotenv";
import app from "./app.js";
import connectDB from "./config/db.js";
import { validateEnv } from "./config/env.js";

dotenv.config();

validateEnv();

// connect database
connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("🚀 Server Started Successfully");
  console.log(`🌐 Running on: http://localhost:${PORT}`);
});
