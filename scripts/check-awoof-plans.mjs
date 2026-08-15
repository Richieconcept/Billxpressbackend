import mongoose from "mongoose";

import DataPlan from "../src/models/dataPlan.model.js";
import DataServiceSetting from "../src/models/dataServiceSetting.model.js";

await mongoose.connect(process.env.MONGO_URI);

const settings = await DataServiceSetting.findOne({ service: "data" }).lean();
const counts = await DataPlan.aggregate([
  { $match: { provider: "2fast" } },
  {
    $group: {
      _id: {
        network: "$network",
        dataType: "$dataType",
        providerAvailable: "$providerAvailable",
        isEnabled: "$isEnabled",
      },
      count: { $sum: 1 },
    },
  },
  {
    $sort: {
      "_id.network": 1,
      "_id.dataType": 1,
      "_id.providerAvailable": 1,
      "_id.isEnabled": 1,
    },
  },
]);

const awoofSamples = await DataPlan.find({
  provider: "2fast",
  $or: [
    { dataType: /AWOOF/i },
    { providerDataType: /AWOOF/i },
    { name: /awoof/i },
  ],
})
  .sort({ network: 1, providerAvailable: -1, networkPrice: 1 })
  .limit(30)
  .lean();

console.log(
  JSON.stringify(
    {
      settings: {
        isEnabled: settings?.isEnabled,
        activeProvider: settings?.activeProvider,
        networkProviders: settings?.networkProviders,
      },
      counts,
      awoofSamples: awoofSamples.map((plan) => ({
        id: String(plan._id),
        providerPlanId: plan.providerPlanId,
        providerPlanCode: plan.providerPlanCode,
        network: plan.network,
        dataType: plan.dataType,
        providerDataType: plan.providerDataType,
        name: plan.name,
        networkPrice: plan.networkPrice,
        providerPrice: plan.providerPrice,
        isEnabled: plan.isEnabled,
        providerAvailable: plan.providerAvailable,
        rawStatus: plan.raw?.status,
        rawType: plan.raw?.type,
        sim: plan.raw?.sim,
        wallet: plan.raw?.wallet,
        device: plan.raw?.device,
        lastSyncedAt: plan.lastSyncedAt,
      })),
    },
    null,
    2
  )
);

await mongoose.disconnect();
