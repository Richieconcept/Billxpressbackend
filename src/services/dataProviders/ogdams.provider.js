const PROVIDER = "ogdams";
const DEFAULT_BASE_URL = "https://simhosting.ogdams.ng/api";

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
  String(process.env.OGDAMS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

const toNumber = (value) => {
  const number = Number(String(value ?? "").replace(/[₦,\s]/g, ""));
  return Number.isFinite(number) ? number : 0;
};

const requestOgdams = async (path, { method = "GET", body } = {}) => {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${getRequiredEnv("OGDAMS_API_TOKEN")}`,
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

  if (!response.ok || data?.status === false || Number(data?.code) === 424) {
    const error = new Error(
      data?.data?.msg || data?.message || data?.msg || "Ogdams request failed"
    );
    error.statusCode = 502;
    error.providerResponse = data;
    error.isFinalProviderFailure = Number(data?.code || response.status) === 424;
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

export const fetchPlans = async () => {
  const response = await requestOgdams("/v4/get/data/plans");
  const networks = response?.data || {};

  return Object.entries(networks).flatMap(([network, plans]) =>
    (Array.isArray(plans) ? plans : []).map((plan) => {
      const providerPrice = toNumber(plan.ourPrice);

      return {
        provider: PROVIDER,
        providerPlanId: String(plan.planId ?? ""),
        providerPlanCode: String(plan.planId ?? ""),
        network: String(network).toUpperCase(),
        networkCode: String(plan.networkId ?? ""),
        name: String(plan.name || ""),
        type: String(plan.type || "OTHER").toUpperCase(),
        providerDataType: String(plan.type || ""),
        validity: plan.validity || null,
        validityDays: parseValidityDays(plan.validity),
        // Ogdams debits our wallet by `ourPrice`; telcoPrice remains in raw.
        networkPrice: providerPrice,
        providerPrice,
        costPrice: providerPrice,
        available: providerPrice > 0,
        raw: plan,
      };
    })
  );
};

const normalizePhone = (value) => {
  const phone = String(value || "").replace(/\D/g, "");
  return phone.startsWith("0") ? `234${phone.slice(1)}` : phone;
};

export const purchaseData = async ({ plan, phone, reference }) => {
  const payload = {
    networkId: Number(plan.networkCode),
    planId: Number(plan.providerPlanId),
    phoneNumber: normalizePhone(phone),
    reference,
  };
  const response = await requestOgdams("/v1/vend/data", {
    method: "POST",
    body: payload,
  });
  const code = Number(response?.code);

  if ([201, 202].includes(code)) {
    const error = new Error(
      response?.data?.msg || "Ogdams data purchase is still processing"
    );
    error.statusCode = 202;
    error.providerResponse = response;
    error.requestPayload = payload;
    error.isProviderPending = true;
    error.isFinalProviderFailure = false;
    throw error;
  }

  if (code !== 200) {
    const error = new Error(response?.data?.msg || "Ogdams data purchase failed");
    error.statusCode = 502;
    error.providerResponse = response;
    error.requestPayload = payload;
    error.isFinalProviderFailure = true;
    throw error;
  }

  return {
    provider: PROVIDER,
    providerReference: response?.data?.ref || reference,
    message: response?.data?.msg || "Data purchase successful",
    raw: response,
    requestPayload: payload,
  };
};

export default {
  name: PROVIDER,
  fetchPlans,
  purchaseData,
};
