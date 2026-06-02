import express from "express";
import adminRoutes from "./routes/admin.routes.js";
import authRoutes from "./routes/auth.routes.js";
import testRoutes from "./routes/test.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";


const app = express();

const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  const allowAnyOrigin = allowedOrigins.length === 0;
  const isAllowedOrigin = requestOrigin && allowedOrigins.includes(requestOrigin);

  if (allowAnyOrigin || isAllowedOrigin) {
    res.header("Access-Control-Allow-Origin", requestOrigin || "*");
    res.header("Access-Control-Allow-Credentials", "true");
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Requested-With"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// middleware
app.use("/api/v1/webhooks", express.raw({ type: "application/json" }), webhookRoutes);
app.use(express.json());

// routes starts here ==============================
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/test", testRoutes);

// test route
app.get("/", (req, res) => {
  res.send("BillXpress API running...");
});

export default app;
