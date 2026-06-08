const API_URL = "https://vheeboost.com.ng/api/v1";

const getApiKey = () => process.env.VHEEBOOST_API_KEY;

const normalizeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const sendRequest = async (payload) => {
  const key = getApiKey();

  if (!key) {
    const error = new Error("VheeBoost API key is not configured");
    error.statusCode = 503;
    throw error;
  }

  const body = new URLSearchParams({
    key,
    ...Object.entries(payload).reduce((acc, [name, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        acc[name] = String(value);
      }

      return acc;
    }, {}),
  });

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok || data?.error || data?.status === "fail") {
    const error = new Error(
      data?.error || data?.message || "VheeBoost request failed"
    );
    error.statusCode = response.ok ? 502 : response.status;
    error.providerResponse = data;
    throw error;
  }

  return data;
};

const normalizeStatus = (status) => {
  const value = String(status || "").trim().toLowerCase();

  if (value === "completed") return "completed";
  if (value === "partial") return "partial";
  if (["canceled", "cancelled"].includes(value)) return "canceled";
  if (["processing", "pending"].includes(value)) return "processing";
  if (["in progress", "in_progress"].includes(value)) return "in_progress";
  if (value === "refunded") return "refunded";

  return value ? "processing" : "pending";
};

const normalizeService = (service) => ({
  provider: "vheeboost",
  providerServiceId: String(service.service),
  name: String(service.name || "").trim(),
  category: String(service.category || "Other").trim(),
  rate: normalizeNumber(service.rate),
  min: Math.max(1, Math.round(normalizeNumber(service.min, 1))),
  max: Math.max(1, Math.round(normalizeNumber(service.max, 1))),
  dripFeed: String(service.drip_feed || "0") === "1",
  refill: String(service.refill || "0") === "1",
  type: service.type || null,
  currency: service.currency || "NGN",
  available: Boolean(service.service && service.name && Number(service.rate) >= 0),
  raw: service,
});

export const vheeboostProvider = {
  name: "vheeboost",

  fetchBalance: async () => {
    const response = await sendRequest({ action: "balance" });

    return {
      balance: normalizeNumber(response.balance),
      currency: response.currency || "NGN",
      raw: response,
    };
  },

  fetchServices: async () => {
    const response = await sendRequest({ action: "services" });
    const services = Array.isArray(response) ? response : [];

    return services.map(normalizeService).filter((service) => service.available);
  },

  createOrder: async ({ service, link, quantity, runs, interval }) => {
    const requestPayload = {
      action: "add",
      service: service.providerServiceId,
      link,
      quantity,
      runs,
      interval,
    };
    const response = await sendRequest(requestPayload);

    if (!response.order) {
      const error = new Error("VheeBoost did not return an order ID");
      error.statusCode = 502;
      error.providerResponse = response;
      throw error;
    }

    return {
      providerOrderId: String(response.order),
      message: response.message || "Social growth order placed successfully",
      requestPayload,
      raw: response,
    };
  },

  fetchOrderStatus: async (providerOrderId) => {
    const response = await sendRequest({
      action: "status",
      order: providerOrderId,
    });

    return {
      status: normalizeStatus(response.status),
      providerStatus: response.status,
      charge: response.charge === null ? null : normalizeNumber(response.charge),
      startCount:
        response.start_count === null ? null : normalizeNumber(response.start_count),
      remains: response.remains === null ? null : normalizeNumber(response.remains),
      currency: response.currency || "NGN",
      raw: response,
    };
  },
};
