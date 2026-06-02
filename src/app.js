import express from "express";
import adminRoutes from "./routes/admin.routes.js";
import authRoutes from "./routes/auth.routes.js";
import testRoutes from "./routes/test.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";


const app = express();

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
