const PROVIDER = "smeplug";
const DEFAULT_BASE_URL = "https://smeplug.ng/api/v1";

const NETWORKS = {
  "1": "MTN",
  "2": "AIRTEL",
  "3": "9MOBILE",
  "4": "GLO",
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
  String(process.env.SMEPLUG_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

const toNumber = (value) => {
  const number = Number(String(value ?? "").replace(/[₦,\s]/g, ""));
  return Number.isFinite(number) ? number : 0;
};

const requestSmeplug = async (path, { method = "GET", body } = {}) => {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${getRequiredEnv("SMEPLUG_API_TOKEN")}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok || data?.status === false) {
    const error = new Error(
      data?.message || data?.msg || data?.error || "SME Plug request failed"
    );
    error.statusCode = 502;
    error.providerResponse = data;
    error.isFinalProviderFailure = response.status >= 400 && response.status < 500;
    throw error;
  }

  return data;
};

const normalizeNetwork = (value, networkId) => {
  const text = String(
    NETWORKS[String(value)] || value || NETWORKS[String(networkId)] || ""
  )
    .trim()
    .toUpperCase();

  if (text.includes("MTN")) return "MTN";
  if (text.includes("AIRTEL")) return "AIRTEL";
  if (text.includes("GLO")) return "GLO";
  if (text.includes("9MOBILE") || text.includes("ETISALAT")) return "9MOBILE";
  return text;
};

const inferDataType = (plan) => {
  const text = [
    plan.type,
    plan.data_type,
    plan.datatype,
    plan.category,
    plan.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (text.includes("AWOOF")) return "AWOOF";
  if (text.includes("CORPORATE")) return "CORPORATE GIFTING";
  if (text.includes("GIFT")) return "GIFTING";
  if (text.includes("SME")) return "SME";
  if (text.includes("SOCIAL")) return "SOCIAL";
  return "OTHER";
};

const collectPlanRecords = (value, context = {}, records = []) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPlanRecords(item, context, records));
    return records;
  }

  if (!value || typeof value !== "object") {
    return records;
  }

  const id = value.id ?? value.plan_id ?? value.planId;
  const name = value.name ?? value.plan_name ?? value.planName;

  if (id !== undefined && name) {
    records.push({ ...context, ...value });
    return records;
  }

  Object.entries(value).forEach(([key, child]) => {
    const nextContext = { ...context };
    const normalizedKey = normalizeNetwork(key);

    if (["MTN", "AIRTEL", "GLO", "9MOBILE"].includes(normalizedKey)) {
      nextContext.network = normalizedKey;
      if (NETWORKS[String(key)]) {
        nextContext.network_id = String(key);
      }
    }

    collectPlanRecords(child, nextContext, records);
  });

  return records;
};

const parseValidityDays = (value) => {
  const match = String(value || "").match(/(\d+)\s*day/i);
  return match ? Number(match[1]) : 0;
};

export const fetchPlans = async () => {
  const response = await requestSmeplug("/data/plans");
  const records = collectPlanRecords(response?.data ?? response);

  return records
    .map((plan) => {
      const networkId =
        plan.network_id ?? plan.networkId ?? plan.network?.id ?? "";
      const network = normalizeNetwork(
        plan.network_name ?? plan.networkName ?? plan.network,
        networkId
      );
      const validity = plan.validity ?? plan.duration ?? null;
      const providerPrice = toNumber(plan.price);
      const networkPrice = toNumber(
        plan.telco_price ?? plan.network_price ?? plan.telcoPrice
      );

      return {
        provider: PROVIDER,
        providerPlanId: String(plan.id ?? plan.plan_id ?? plan.planId ?? ""),
        providerPlanCode: String(
          plan.code ?? plan.plan_code ?? plan.id ?? plan.plan_id ?? ""
        ),
        network,
        networkCode: String(networkId),
        name: String(plan.name ?? plan.plan_name ?? plan.planName ?? ""),
        type: inferDataType(plan),
        providerDataType: String(
          plan.type ?? plan.data_type ?? plan.datatype ?? plan.category ?? ""
        ),
        validity,
        validityDays: parseValidityDays(validity),
        networkPrice,
        providerPrice,
        costPrice: Math.max(networkPrice, providerPrice),
        available:
          plan.status === undefined &&
          plan.available === undefined &&
          plan.is_active === undefined
            ? true
            : !["false", "0", "inactive", "disabled"].includes(
                String(plan.status ?? plan.available ?? plan.is_active).toLowerCase()
              ),
        raw: plan,
      };
    })
    .filter((plan) => plan.providerPlanId && plan.network && plan.name);
};

export const purchaseData = async ({ plan, phone, reference }) => {
  const networkId = String(plan.networkCode || plan.raw?.network_id || "");
  const planId = String(plan.providerPlanId);
  const payload = {
    network_id: /^\d+$/.test(networkId) ? Number(networkId) : networkId,
    plan_id: /^\d+$/.test(planId) ? Number(planId) : planId,
    phone,
    customer_reference: reference,
  };
  const response = await requestSmeplug("/data/purchase", {
    method: "POST",
    body: payload,
  });

  return {
    provider: PROVIDER,
    providerReference:
      response?.data?.reference || response?.reference || reference,
    message: response?.data?.msg || response?.message || "Data purchase submitted",
    raw: response,
    requestPayload: payload,
  };
};

export const checkTransactionStatus = (reference) =>
  requestSmeplug(`/transactions/${encodeURIComponent(reference)}`);

export default {
  name: PROVIDER,
  fetchPlans,
  purchaseData,
  checkTransactionStatus,
};
