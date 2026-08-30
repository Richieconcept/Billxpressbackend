import mongoose from "mongoose";

import DataPlan from "../src/models/dataPlan.model.js";
import DataServiceSetting from "../src/models/dataServiceSetting.model.js";

const DATA_NETWORKS = ["MTN", "AIRTEL", "GLO", "9MOBILE"];

const normalizeProviderList = (value, fallbackProvider) => {
  const rawProviders = Array.isArray(value) ? value : value ? [value] : [];
  const providers = rawProviders
    .map((provider) => String(provider || "").trim().toLowerCase())
    .filter(Boolean)
    .filter((provider, index, self) => self.indexOf(provider) === index);

  return providers.length > 0 ? providers : [fallbackProvider];
};

await mongoose.connect(process.env.MONGO_URI);

const settings = await DataServiceSetting.findOne({ service: "data" }).lean();
const networkProviders = DATA_NETWORKS.reduce((result, network) => {
  result[network] = normalizeProviderList(
    settings?.networkProviders?.[network],
    settings?.activeProvider || "smeapi"
  );
  return result;
}, {});

const enabledPlans = await DataPlan.find({ isEnabled: true })
  .select("provider network dataType name ourPrice vendorPrice providerAvailable allowHostedSim allowWalletFallback providerPrice networkPrice")
  .lean();

const visible = enabledPlans.filter((plan) =>
  (networkProviders[plan.network] || []).includes(plan.provider)
);
const hidden = enabledPlans.filter(
  (plan) => !(networkProviders[plan.network] || []).includes(plan.provider)
);

const summarize = (plans) =>
  plans.reduce((result, plan) => {
    const key = `${plan.network}:${plan.provider}`;
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});

console.log(
  JSON.stringify(
    {
      activeProvider: settings?.activeProvider,
      networkProviders,
      enabledCount: enabledPlans.length,
      visibleCount: visible.length,
      hiddenCount: hidden.length,
      visibleByNetworkProvider: summarize(visible),
      hiddenByNetworkProvider: summarize(hidden),
      hiddenSamples: hidden.slice(0, 30),
    },
    null,
    2
  )
);

await mongoose.disconnect();
