const PROVIDER = "uniteddata2";
const NETWORKS = { "1": "MTN", "2": "GLO", "3": "9MOBILE", "4": "AIRTEL" };
const NETWORK_CODES = Object.fromEntries(Object.entries(NETWORKS).map(([id, name]) => [name, Number(id)]));
const getBaseUrl = () => String(process.env.UNITEDDATA2_BASE_URL || "https://uniteddata2.com.ng").replace(/\/+$/, "");
const getApiKey = () => {
  const key = String(process.env.UNITEDDATA2_API_KEY || "").trim();
  if (!key) {
    const error = new Error("UNITEDDATA2_API_KEY is not configured");
    error.statusCode = 503;
    error.isFinalProviderFailure = true;
    throw error;
  }
  return key;
};
const readJson = async (response) => {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { message: text || "Invalid provider response" }; }
};
const parsePrice = (value) => {
  const price = Number(String(value ?? "").replace(/[,₦\s]/g, ""));
  return Number.isFinite(price) ? price : 0;
};
export const fetchPlans = async () => {
  const key = getApiKey();
  const groups = await Promise.all(Object.entries(NETWORKS).map(async ([networkId, network]) => {
    const response = await fetch(getBaseUrl() + "/api/data/data_plan.php", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Token " + key },
      body: JSON.stringify({ NetworkId: Number(networkId) }),
    });
    const data = await readJson(response);
    if (!response.ok || String(data?.success) !== "1" || !Array.isArray(data?.plans)) {
      const error = new Error("UnitedData2 plan lookup failed for " + network);
      error.providerResponse = data;
      throw error;
    }
    return data.plans.flatMap((plan) => {
      const id = String(plan.PlanId ?? "").trim();
      const price = parsePrice(plan.price);
      const name = String(plan.PlanName || "").trim();
      if (!/^\d+$/.test(id) || !name || price <= 0 || (plan.NetworkId != null && String(plan.NetworkId) !== networkId)) return [];
      const validity = String(plan.Validity || "").trim();
      return [{
        provider: PROVIDER, providerPlanId: id, providerPlanCode: id, network, networkCode: networkId,
        name, type: String(plan.DataType || "OTHER").trim().toUpperCase(),
        providerDataType: String(plan.DataType || ""), validity: validity || null,
        validityDays: Number(validity.match(/(\d+)\s*days?/i)?.[1] || 0),
        networkPrice: 0, providerPrice: price, costPrice: price, available: true, raw: plan,
      }];
    });
  }));
  return groups.flat();
};
export const purchaseData = async ({ plan, phone, reference }) => {
  const key = getApiKey();
  const network = NETWORK_CODES[String(plan.network || "").toUpperCase()];
  const planId = String(plan.providerPlanCode || plan.providerPlanId || "");
  if (!network || !/^\d+$/.test(planId) || !/^0\d{10}$/.test(phone)) {
    const error = new Error("Invalid UnitedData2 network, plan or phone number");
    error.statusCode = 400; error.isFinalProviderFailure = true; throw error;
  }
  const payload = { network, phone, data_plan: Number(planId) };
  let response, data;
  try {
    response = await fetch(getBaseUrl() + "/api/data/", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Token " + key },
      body: JSON.stringify(payload),
    });
    data = await readJson(response);
  } catch (cause) {
    const error = new Error("UnitedData2 purchase outcome is unknown", { cause });
    error.isProviderPending = true; error.providerResponse = { reference }; error.requestPayload = payload;
    throw error;
  }
  const status = String(data?.status || data?.Status || "").trim().toLowerCase();
  if (response.ok && ["success", "successful"].includes(status)) {
    return { provider: PROVIDER, providerReference: String(data.id || data.ref || reference), message: data.msg || data.api_response || "Data purchase successful", raw: data, requestPayload: payload };
  }
  const error = new Error(data?.msg || data?.message || "UnitedData2 purchase outcome is unknown");
  error.providerResponse = { ...data, reference: data?.id || data?.ref || reference };
  error.requestPayload = payload;
  error.isFinalProviderFailure = response.status < 500 && ["fail", "failed", "failure"].includes(status);
  error.isProviderPending = !error.isFinalProviderFailure;
  throw error;
};
export default { name: PROVIDER, fetchPlans, purchaseData };
