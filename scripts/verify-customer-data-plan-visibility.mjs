import mongoose from "mongoose";

import User from "../src/models/user.model.js";
import { getDataPlansForUser } from "../src/services/dataService.service.js";

await mongoose.connect(process.env.MONGO_URI);

const user = await User.findOne({ isActive: true }).sort({ createdAt: -1 });

if (!user) {
  throw new Error("No active user found for visibility check");
}

const result = await getDataPlansForUser(user);
const byProvider = result.plans.reduce((summary, plan) => {
  const key = `${plan.network}:${plan.provider || "hidden-provider-field"}`;
  summary[key] = (summary[key] || 0) + 1;
  return summary;
}, {});
const dataSharePlans = result.plans.filter(
  (plan) => plan.network === "MTN" && plan.type === "DATA SHARE"
);

console.log(
  JSON.stringify(
    {
      userId: user._id,
      count: result.plans.length,
      provider: result.provider,
      byProvider,
      mtnDataShareCount: dataSharePlans.length,
      samples: result.plans.slice(0, 20),
      dataShareSamples: dataSharePlans.slice(0, 10),
    },
    null,
    2
  )
);

await mongoose.disconnect();
