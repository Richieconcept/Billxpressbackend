const PROVIDER = "ujaydata";

const getBaseUrl = () =>
  (process.env.UJAYDATA_BASE_URL || "https://ujaydata.com.ng/api").replace(
    /\/+$/,
    ""
  );

const toNumber = (value) => {
  const numericValue = Number(String(value || "").replace(/,/g, ""));

  return Number.isFinite(numericValue) ? numericValue : 0;
};

const requestUjayData = async (path, options = {}) => {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(process.env.UJAYDATA_API_KEY
      ? { Authorization: `Token ${process.env.UJAYDATA_API_KEY}` }
      : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error("UjayData request failed");
    error.statusCode = 502;
    error.providerResponse = data;
    throw error;
  }

  return data;
};

const isPlanAvailable = (plan) =>
  String(plan.networkStatus || "").toLowerCase() === "on";

export const fetchPlans = async () => {
  const response = await requestUjayData("/data?plans");
  const plans = Array.isArray(response.plans) ? response.plans : [];

  return plans.map((plan) => ({
    provider: PROVIDER,
    providerPlanId: String(plan.pId || plan.planid || ""),
    providerPlanCode: String(plan.planid || plan.pId || ""),
    network: String(plan.network || "").toUpperCase(),
    networkCode: String(plan.datanetwork || plan.networkid || ""),
    name: String(plan.name || ""),
    type: String(plan.type || ""),
    validity: plan.day ? `${plan.day} day${String(plan.day) === "1" ? "" : "s"}` : null,
    validityDays: toNumber(plan.day),
    costPrice: toNumber(plan.price),
    available: isPlanAvailable(plan),
    raw: plan,
  }));
};

const getPurchasePlanValue = (plan) => {
  const valueKey = process.env.UJAYDATA_DATA_PURCHASE_PLAN_VALUE || "planid";
  const rawPlan = plan.raw || {};

  return (
    rawPlan[valueKey] ||
    plan[valueKey] ||
    rawPlan.planid ||
    rawPlan.pId ||
    plan.providerPlanCode ||
    plan.providerPlanId ||
    plan.name
  );
};

const isSuccessfulPurchase = (response) => {
  const status = String(response?.status || "").toLowerCase();
  const message = String(response?.message || "").toLowerCase();

  return status === "success" || message.includes("successful");
};

export const purchaseData = async ({ plan, phone, reference }) => {
  const planField = process.env.UJAYDATA_DATA_PURCHASE_PLAN_FIELD || "plan";
  const payload = {
    network: plan.network,
    phone,
    [planField]: String(getPurchasePlanValue(plan)),
  };

  const response = await requestUjayData("/data", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!isSuccessfulPurchase(response)) {
    const error = new Error(response?.message || "Data purchase failed");
    error.statusCode = 502;
    error.providerResponse = response;
    throw error;
  }

  return {
    provider: PROVIDER,
    providerReference:
      response.transaction_id ||
      response.transactionId ||
      response.reference ||
      reference,
    message: response.message || "Data purchase successful",
    raw: response,
    requestPayload: payload,
  };
};

export const checkTransactionStatus = async (providerReference) =>
  requestUjayData(`/transaction/${encodeURIComponent(providerReference)}`);

export default {
  name: PROVIDER,
  fetchPlans,
  purchaseData,
  checkTransactionStatus,
};
