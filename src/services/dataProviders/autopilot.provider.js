import crypto from "crypto";

const PROVIDER = "autopilot";
const DEFAULT_BASE_URL = "https://autopilotng.com/api/live";

let planCache = {
  expiresAt: 0,
  plans: [],
};

const getRequiredEnv = (name) => {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    const error = new Error(`${name} is not configured`);
    error.statusCode = 503;
    throw error;
  }

  return value;
};

const getBaseUrl = () =>
  String(process.env.AUTOPILOT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

const toNumber = (value) => {
  const number = Number(String(value ?? "").replace(/[₦,\s]/g, ""));
  return Number.isFinite(number) ? number : 0;
};

const getProducts = (response) => {
  const products = response?.data?.product;
  return Array.isArray(products) ? products : [];
};

const isSuccessfulResponse = (response) =>
  response?.status === true && Number(response?.code) >= 200 && Number(response?.code) < 300;

const isConfirmedFailureResponse = (response) => {
  const code = Number(response?.code);
  const text = String(
    response?.data?.message || response?.message || response?.error || ""
  ).toLowerCase();

  return (
    code === 424 ||
    /\b(failed|invalid|incorrect|ineligible|declined|rejected|unavailable)\b/.test(
      text
    ) ||
    /\b(insufficient|low balance|fund wallet|out of funds)\b/.test(text)
  );
};

const requestAutopilot = async (path, payload) => {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${getRequiredEnv("AUTOPILOT_API_KEY")}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok || !isSuccessfulResponse(data)) {
    const error = new Error(
      data?.data?.message || data?.message || "Autopilot request failed"
    );
    error.statusCode = 502;
    error.providerResponse = data;
    error.isFinalProviderFailure =
      response.status >= 400 &&
      response.status < 500 &&
      isConfirmedFailureResponse(data);
    throw error;
  }

  return data;
};

const getLagosTimestamp = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .reduce((values, part) => {
      values[part.type] = part.value;
      return values;
    }, {});

  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
};

const generateAutopilotReference = () =>
  `${getLagosTimestamp()}${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

const parseValidityDays = (validity) => {
  const match = String(validity || "").match(/(\d+)\s*day/i);
  return match ? Number(match[1]) : 0;
};

const getPlanCacheTtlMs = () => {
  const seconds = Number(process.env.AUTOPILOT_PLAN_CACHE_TTL_SECONDS || 300);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 300000;
};

const fetchPlansForType = async (network, dataType) => {
  const response = await requestAutopilot("/v1/load/data", {
    networkId: String(network.networkId),
    dataType: dataType.name,
  });

  return getProducts(response).map((plan) => ({
    provider: PROVIDER,
    providerPlanId: String(plan.planId || ""),
    providerPlanCode: String(plan.planId || ""),
    network: String(network.network || dataType.network || "").toUpperCase(),
    networkCode: String(network.networkId || dataType.networkId || ""),
    name: String(plan.planName || plan.bundle || plan.description || ""),
    type: String(plan.type || dataType.name || ""),
    validity: plan.Validity || plan.validity || null,
    validityDays: parseValidityDays(plan.Validity || plan.validity),
    costPrice: toNumber(plan.ourPrice),
    available: String(plan.ourStatus || "").toUpperCase() === "ACTIVE",
    raw: {
      ...plan,
      networkId: network.networkId,
      network: network.network,
      dataType: dataType.name,
    },
  }));
};

export const fetchPlans = async () => {
  if (planCache.expiresAt > Date.now()) {
    return planCache.plans;
  }

  const networkResponse = await requestAutopilot("/v1/load/networks", {
    networks: "all",
  });
  const networks = getProducts(networkResponse);
  const typeGroups = await Promise.all(
    networks.map(async (network) => {
      const response = await requestAutopilot("/v1/load/data-types", {
        networkId: String(network.networkId),
      });

      return getProducts(response).map((dataType) => ({ network, dataType }));
    })
  );
  const planGroups = await Promise.all(
    typeGroups
      .flat()
      .map(({ network, dataType }) => fetchPlansForType(network, dataType))
  );
  const plans = planGroups
    .flat()
    .filter((plan) => plan.providerPlanId && plan.network && plan.costPrice > 0);

  planCache = {
    expiresAt: Date.now() + getPlanCacheTtlMs(),
    plans,
  };

  return plans;
};

export const purchaseData = async ({ plan, phone }) => {
  const autopilotReference = generateAutopilotReference();
  const payload = {
    networkId: String(plan.raw?.networkId || plan.networkCode),
    dataType: String(plan.raw?.dataType || plan.type),
    planId: String(plan.providerPlanId),
    phone,
    reference: autopilotReference,
  };

  let response;

  try {
    response = await requestAutopilot("/v1/data", payload);
  } catch (error) {
    error.providerResponse = {
      ...(error.providerResponse && typeof error.providerResponse === "object"
        ? error.providerResponse
        : {}),
      reference: autopilotReference,
    };
    throw error;
  }

  return {
    provider: PROVIDER,
    // Autopilot's status endpoint expects the reference supplied by us.
    providerReference: autopilotReference,
    message: response?.data?.message || "Data purchase successful",
    raw: response,
    requestPayload: payload,
  };
};

export const checkTransactionStatus = (providerReference) =>
  requestAutopilot("/v1/transaction/status/data", {
    reference: providerReference,
  });

export default {
  name: PROVIDER,
  fetchPlans,
  purchaseData,
  checkTransactionStatus,
};
