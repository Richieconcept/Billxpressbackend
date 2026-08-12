import { getOrCreateDataServiceSetting, syncDataPlans } from "./dataService.service.js";
import { getDataProvider } from "./dataProviders/index.js";

const DATA_NETWORKS = ["MTN", "AIRTEL", "GLO", "9MOBILE"];
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 60 * 1000;
const CATALOG_PROVIDERS = new Set([
  "2fast",
  "autopilot",
  "smeapi",
  "smeplug",
  "ujaydata",
  "ogdams",
]);

let intervalHandle = null;
let isRunning = false;

const isEnabled = () =>
  String(process.env.DATA_PLAN_SYNC_ENABLED ?? "true").toLowerCase() !== "false";

const getIntervalMs = () => {
  const value = Number(process.env.DATA_PLAN_SYNC_INTERVAL_MS || DEFAULT_INTERVAL_MS);

  return Number.isFinite(value) && value > 0 ? value : DEFAULT_INTERVAL_MS;
};

const getInitialDelayMs = () => {
  const value = Number(
    process.env.DATA_PLAN_SYNC_INITIAL_DELAY_MS || DEFAULT_INITIAL_DELAY_MS
  );

  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_INITIAL_DELAY_MS;
};

const normalizeProviderNames = (value) =>
  String(value || "")
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);

const getConfiguredProviders = async () => {
  const envProviders = normalizeProviderNames(process.env.DATA_PLAN_SYNC_PROVIDERS);

  if (envProviders.length > 0) {
    return [...new Set(envProviders)];
  }

  const settings = await getOrCreateDataServiceSetting();
  const providers = [
    settings.activeProvider,
    ...DATA_NETWORKS.map((network) => settings.networkProviders?.[network]),
  ].filter(Boolean);

  return [...new Set(providers.map((provider) => provider.toLowerCase()))];
};

const syncProvider = async (providerName) => {
  const provider = getDataProvider(providerName);

  if (!CATALOG_PROVIDERS.has(provider.name)) {
    return {
      provider: provider.name,
      skipped: true,
      reason: "Provider does not use the saved data-plan catalogue",
    };
  }

  return syncDataPlans({ providerName: provider.name });
};

export const runDataPlanSync = async () => {
  if (!isEnabled()) {
    return { skipped: true, reason: "Data plan sync scheduler is disabled" };
  }

  if (isRunning) {
    return { skipped: true, reason: "Data plan sync is already running" };
  }

  isRunning = true;

  try {
    const providers = await getConfiguredProviders();
    const results = [];

    for (const providerName of providers) {
      try {
        const result = await syncProvider(providerName);
        results.push({ provider: providerName, ok: true, result });
      } catch (error) {
        results.push({
          provider: providerName,
          ok: false,
          message: error.message,
          statusCode: error.statusCode,
        });
      }
    }

    return { providers, results };
  } finally {
    isRunning = false;
  }
};

export const startDataPlanSyncScheduler = () => {
  if (!isEnabled()) {
    console.log("Data plan sync scheduler is disabled");
    return null;
  }

  if (intervalHandle) {
    return intervalHandle;
  }

  const intervalMs = getIntervalMs();
  const runAndLog = () => {
    runDataPlanSync()
      .then((result) => {
        if (result?.skipped) {
          console.log(`Data plan sync skipped: ${result.reason}`);
          return;
        }

        const summary = result.results
          .map((item) =>
            item.ok
              ? `${item.provider}:ok`
              : `${item.provider}:failed(${item.message})`
          )
          .join(", ");

        console.log(`Data plan sync completed: ${summary || "no providers"}`);
      })
      .catch((error) => {
        console.error("Data plan sync failed:", error.message);
      });
  };

  setTimeout(runAndLog, getInitialDelayMs());
  intervalHandle = setInterval(runAndLog, intervalMs);

  console.log(`Data plan sync scheduler started (${intervalMs}ms interval)`);
  return intervalHandle;
};

export default {
  runDataPlanSync,
  startDataPlanSyncScheduler,
};
