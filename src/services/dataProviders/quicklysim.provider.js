const PROVIDER = "quicklysim";
const NETWORK_CODES = { MTN: "1", GLO: "2", AIRTEL: "4" };
const baseUrl = () => String(process.env.QUICKLYSIM_BASE_URL || "https://quicklysim.com").replace(/\/+$/, "");
const apiKey = () => {
  const key = String(process.env.QUICKLYSIM_API_KEY || "").trim();
  if (!key) { const error = new Error("QUICKLYSIM_API_KEY is not configured"); error.statusCode = 503; error.isFinalProviderFailure = true; throw error; }
  return key;
};
const parseResponse = async (response) => {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { message: text || "Invalid provider response" }; }
};
export const fetchPlans = async () => {
  const response = await fetch(baseUrl() + "/api/data-plan", { headers: { Accept: "application/json", Authorization: "Token " + apiKey() } });
  const data = await parseResponse(response);
  if (!response.ok || !Array.isArray(data)) { const error = new Error("QuicklySIM plan lookup failed"); error.providerResponse = data; throw error; }
  return data.flatMap((plan) => {
    const network = String(plan.network || "").trim().toUpperCase();
    const id = String(plan.plan_id ?? "");
    const price = Number(String(plan.price ?? "").replace(/[,₦\s]/g, ""));
    const validity = String(plan.validate || "");
    if (!NETWORK_CODES[network] || !/^\d+$/.test(id) || !Number.isFinite(price) || price <= 0 || !plan.plan_name) return [];
    return [{ provider: PROVIDER, providerPlanId: id, providerPlanCode: id, network, networkCode: NETWORK_CODES[network], name: String(plan.plan_name), type: String(plan.network_type || "OTHER").toUpperCase(), validity: validity || null, validityDays: Number(validity.match(/(\d+)\s*days?/i)?.[1] || 0), networkPrice: 0, providerPrice: price, costPrice: price, available: true, raw: plan }];
  });
};
export const purchaseData = async ({ plan, phone, reference }) => {
  const key = apiKey();
  const network = NETWORK_CODES[String(plan.network || "").toUpperCase()];
  const planId = String(plan.providerPlanCode || plan.providerPlanId || "");
  if (!network || !/^\d+$/.test(planId) || !/^0\d{10}$/.test(phone)) { const error = new Error("Invalid QuicklySIM network, plan or phone number"); error.statusCode = 400; error.isFinalProviderFailure = true; throw error; }
  const payload = { network, mobile_number: phone, plan: Number(planId), ref: reference, ported_number: false };
  let response, data;
  try {
    response = await fetch(baseUrl() + "/topupmate/api/data", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Token " + key }, body: JSON.stringify(payload) });
    data = await parseResponse(response);
  } catch (cause) {
    const error = new Error("QuicklySIM purchase outcome is unknown", { cause });
    error.isProviderPending = true; error.providerResponse = { reference }; error.requestPayload = payload; throw error;
  }
  const status = String(data?.status || data?.Status || "").trim().toLowerCase();
  if (response.ok && ["success", "successful"].includes(status)) return { provider: PROVIDER, providerReference: reference, message: data.true_response || data.message || "Data purchase successful", raw: data, requestPayload: payload };
  const error = new Error(data?.true_response || data?.message || "QuicklySIM purchase outcome is unknown");
  error.providerResponse = { ...data, reference }; error.requestPayload = payload;
  error.isFinalProviderFailure = [400, 403, 404, 422].includes(response.status) || (response.status < 500 && ["fail", "failed"].includes(status));
  error.isProviderPending = !error.isFinalProviderFailure;
  throw error;
};
export default { name: PROVIDER, fetchPlans, purchaseData };
