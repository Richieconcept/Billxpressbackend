import { fetchPlans } from "../src/services/dataProviders/twofast.provider.js";

const plans = await fetchPlans({ forceRefresh: true });

const counts = plans.reduce((summary, plan) => {
  const key = [
    plan.network,
    plan.type,
    plan.available === false ? "unavailable" : "available",
  ].join("|");
  summary[key] = (summary[key] || 0) + 1;
  return summary;
}, {});

const duplicateIds = Object.values(
  plans.reduce((groups, plan) => {
    const key = `${plan.provider}:${plan.providerPlanId}`;
    groups[key] = groups[key] || [];
    groups[key].push({
      network: plan.network,
      type: plan.type,
      name: plan.name,
      available: plan.available,
      rawType: plan.raw?.type,
      rawStatus: plan.raw?.status,
    });
    return groups;
  }, {})
).filter((group) => group.length > 1);

console.log(
  JSON.stringify(
    {
      envTypes: process.env.TWOFAST_DATA_PLAN_TYPES || null,
      total: plans.length,
      counts,
      awoofSamples: plans
        .filter((plan) => /AWOOF/i.test(plan.type) || /awoof/i.test(plan.name))
        .slice(0, 30)
        .map((plan) => ({
          providerPlanId: plan.providerPlanId,
          network: plan.network,
          type: plan.type,
          name: plan.name,
          available: plan.available,
          rawStatus: plan.raw?.status,
          rawType: plan.raw?.type,
          sim: plan.raw?.sim,
          wallet: plan.raw?.wallet,
          device: plan.raw?.device,
        })),
      duplicateIdGroups: duplicateIds.slice(0, 20),
      duplicateIdGroupCount: duplicateIds.length,
    },
    null,
    2
  )
);
