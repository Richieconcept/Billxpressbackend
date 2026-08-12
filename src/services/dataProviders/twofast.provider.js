const PROVIDER = "2fast";
const DEFAULT_BASE_URL = "https://2fast.com.ng/api";

const NETWORKS = {
  "1": "MTN",
  "2": "AIRTEL",
  "3": "GLO",
};

const NETWORK_CODES = Object.entries(NETWORKS).reduce((codes, [code, name]) => {
  codes[name] = code;
  return codes;
}, {});

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
  String(process.env.TWOFAST_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

const toNumber = (value) => {
  const number = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(number) ? number : 0;
};

const normalizeStatus = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const isSuccessfulResponse = (data) => normalizeStatus(data?.status) === "success";

const isConfirmedFailureResponse = (data) => {
  const text = [data?.status, data?.message, data?.error, data?.data?.status]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    /\b(error|failed|fail|declined|rejected|cancelled|canceled)\b/.test(text) ||
    /\b(invalid|incorrect|not found|not available|unavailable|disabled)\b/.test(
      text
    ) ||
    /\b(insufficient|low|fund wallet|top up|out of funds|balance)\b/.test(text)
  );
};

const requestTwoFast = async (path, body) => {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${getRequiredEnv("TWOFAST_CONTRACT_ID")}`,
    },
    body: JSON.stringify(body),
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
      data?.message || data?.error || "2Fast request failed"
    );
    error.statusCode = response.status === 503 ? 503 : 502;
    error.providerResponse = data;
    error.isFinalProviderFailure =
      response.status >= 400 &&
      response.status < 500 &&
      isConfirmedFailureResponse(data);
    throw error;
  }

  return data;
};

const parseValidityDays = (value) => {
  const text = String(value || "");
  const number = Number(text.match(/\d+/)?.[0] || 0);

  if (/year/i.test(text)) return number * 365;
  if (/month/i.test(text)) return number * 30;
  return number;
};

const isEnabledText = (value) => {
  const text = normalizeStatus(value);

  if (!text) return true;
  return ["active", "yes", "true", "1", "enabled", "available"].includes(text);
};

const isPlanAvailable = (plan) => {
  const routeFlags = [plan.sim, plan.wallet, plan.device].filter(
    (value) => value !== undefined && value !== null && value !== ""
  );
  const hasUsableRoute = routeFlags.some(isEnabledText);
  const routeFlagsAbsent =
    routeFlags.length === 0;

  return isEnabledText(plan.status) && (routeFlagsAbsent || hasUsableRoute);
};

const getPlanTypes = () =>
  String(process.env.TWOFAST_DATA_PLAN_TYPES || "")
    .split(",")
    .map((type) => type.trim())
    .filter(Boolean);

const getPlanCacheTtlMs = () => {
  const seconds = Number(process.env.TWOFAST_PLAN_CACHE_TTL_SECONDS || 300);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 300000;
};

const fetchPlansForNetwork = async (networkCode, type) => {
  const payload = {
    network: Number(networkCode),
    status: "Active",
    limit: Number(process.env.TWOFAST_DATA_PLAN_LIMIT || 500),
    ...(type ? { type } : {}),
  };
  const response = await requestTwoFast("/data-plans", payload);
  const records = Array.isArray(response?.data) ? response.data : [];
  const network = NETWORKS[String(networkCode)] || String(response?.network || "");

  return records.map((plan) => {
    const providerPrice = toNumber(plan.our_price ?? plan.ourPrice ?? plan.price);
    const networkPrice = toNumber(
      plan.telecom_price ?? plan.telecomPrice ?? plan.network_price
    );
    const validity = plan.validity || null;

    return {
      provider: PROVIDER,
      providerPlanId: String(plan.plan_id ?? plan.planId ?? plan.id ?? ""),
      providerPlanCode: String(plan.plan_id ?? plan.planId ?? plan.id ?? ""),
      network: String(network).toUpperCase(),
      networkCode: String(networkCode),
      name: String(plan.description || plan.volume || plan.name || ""),
      type: String(plan.type || type || "OTHER").toUpperCase(),
      providerDataType: String(plan.type || type || ""),
      validity,
      validityDays: parseValidityDays(validity),
      networkPrice: providerPrice,
      providerPrice,
      costPrice: providerPrice,
      available: providerPrice > 0 && isPlanAvailable(plan),
      raw: {
        ...plan,
        telecom_price: networkPrice || plan.telecom_price,
        networkCode: String(networkCode),
      },
    };
  });
};

export const fetchPlans = async ({ forceRefresh = false } = {}) => {
  if (!forceRefresh && planCache.expiresAt > Date.now()) {
    return planCache.plans;
  }

  const planTypes = getPlanTypes();
  const typeFilters = planTypes.length > 0 ? planTypes : [null];
  const planGroups = await Promise.all(
    Object.keys(NETWORKS).flatMap((networkCode) =>
      typeFilters.map((type) => fetchPlansForNetwork(networkCode, type))
    )
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

export const purchaseData = async ({ plan, phone, reference }) => {
  const networkId = String(
    plan.networkCode || plan.raw?.networkCode || NETWORK_CODES[plan.network] || ""
  );
  const payload = {
    networkId: /^\d+$/.test(networkId) ? Number(networkId) : networkId,
    planId: String(plan.providerPlanId),
    phoneNumber: phone,
    reference,
  };
  const response = await requestTwoFast("/data", payload);

  return {
    provider: PROVIDER,
    providerReference: response?.data?.reference || response?.reference || reference,
    message: response?.message || "Data purchase successful",
    raw: response,
    requestPayload: payload,
  };
};

export const checkTransactionStatus = (reference) =>
  requestTwoFast("/transaction-history", { reference });

export default {
  name: PROVIDER,
  fetchPlans,
  purchaseData,
  checkTransactionStatus,
};
