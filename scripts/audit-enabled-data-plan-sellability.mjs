import mongoose from "mongoose";

import DataPlan from "../src/models/dataPlan.model.js";

await mongoose.connect(process.env.MONGO_URI);

const plans = await DataPlan.find({ isEnabled: true })
  .select("provider network dataType name ourPrice vendorPrice providerAvailable providerPlanId providerPlanCode allowHostedSim allowWalletFallback providerPrice networkPrice raw")
  .lean();

const isEnabledText = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return true;
  return ["active", "yes", "true", "1", "enabled", "available"].includes(text);
};

const isStoredTwoFastManualPlan = (plan) => {
  const text = [plan.dataType, plan.providerDataType, plan.raw?.type, plan.name]
    .filter(Boolean)
    .join(" ");
  if (plan.provider !== "2fast") return false;
  const planId = String(plan.providerPlanId || plan.providerPlanCode || "");
  const isKnownManualPlan = ["519", "5188", "520", "521", "522"].includes(planId);
  const hasManualRoute =
    isEnabledText(plan.raw?.sim) ||
    isEnabledText(plan.raw?.wallet) ||
    isEnabledText(plan.raw?.device);
  const isActive = isEnabledText(plan.raw?.status);
  return /\bAWOOF\b/i.test(text) || (isKnownManualPlan && hasManualRoute && isActive);
};

const sellable = plans.filter(
  (plan) => plan.providerPlanId && (plan.providerAvailable || isStoredTwoFastManualPlan(plan))
);
const unsellable = plans.filter(
  (plan) => !plan.providerPlanId || !(plan.providerAvailable || isStoredTwoFastManualPlan(plan))
);

const summarize = (items) =>
  items.reduce((summary, plan) => {
    const key = `${plan.network}:${plan.provider}:available=${plan.providerAvailable}`;
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});

console.log(
  JSON.stringify(
    {
      enabledCount: plans.length,
      sellableCount: sellable.length,
      unsellableCount: unsellable.length,
      sellableByProvider: summarize(sellable),
      unsellableByProvider: summarize(unsellable),
      unsellableSamples: unsellable.slice(0, 40).map((plan) => ({
        id: plan._id,
        provider: plan.provider,
        network: plan.network,
        dataType: plan.dataType,
        name: plan.name,
        providerAvailable: plan.providerAvailable,
        providerPlanId: plan.providerPlanId,
        providerPlanCode: plan.providerPlanCode,
        ourPrice: plan.ourPrice,
        providerPrice: plan.providerPrice,
        networkPrice: plan.networkPrice,
        allowHostedSim: plan.allowHostedSim,
        allowWalletFallback: plan.allowWalletFallback,
        rawStatus: plan.raw?.status,
        rawWallet: plan.raw?.wallet,
        rawSim: plan.raw?.sim,
        rawDevice: plan.raw?.device,
      })),
    },
    null,
    2
  )
);

await mongoose.disconnect();
