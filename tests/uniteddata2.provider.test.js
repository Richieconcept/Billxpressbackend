import test from "node:test";
import assert from "node:assert/strict";
import { fetchPlans, purchaseData } from "../src/services/dataProviders/uniteddata2.provider.js";

process.env.UNITEDDATA2_API_KEY = "test-key";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
test("fetches and maps all four networks with documented IDs", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    assert.match(url, /\/api\/data\/data_plan\.php$/);
    assert.equal(options.headers.Authorization, "Token test-key");
    const { NetworkId } = JSON.parse(options.body);
    calls.push(NetworkId);
    return json({ success: "1", plans: [
      { PlanId: NetworkId * 10, PlanName: "1GB", price: "1,250", NetworkId: String(NetworkId), DataType: "sme", Validity: "30 days" },
      { PlanId: 999, PlanName: "Warning", price: 0, NetworkId: String(NetworkId) },
    ] });
  };
  const plans = await fetchPlans();
  assert.deepEqual(calls, [1, 2, 3, 4]);
  assert.deepEqual(plans.map((p) => p.network), ["MTN", "GLO", "9MOBILE", "AIRTEL"]);
  assert.equal(plans[0].providerPrice, 1250);
  assert.equal(plans[0].validityDays, 30);
});
test("rejects incomplete plan responses rather than syncing a partial catalogue", async () => {
  global.fetch = async (url, options) => JSON.parse(options.body).NetworkId === 3
    ? json({ success: "0", message: "unavailable" })
    : json({ success: "1", plans: [] });
  await assert.rejects(fetchPlans(), /plan lookup failed for 9MOBILE/);
});
test("sends a documented purchase and stores provider reference", async () => {
  global.fetch = async (url, options) => {
    assert.match(url, /\/api\/data\/$/);
    assert.equal(options.headers.Authorization, "Token test-key");
    assert.deepEqual(JSON.parse(options.body), { network: 4, phone: "08012345678", data_plan: 10 });
    return json({ status: "success", id: "DATA|TRANSACTION|123", msg: "Data sent" });
  };
  const result = await purchaseData({ plan: { network: "AIRTEL", providerPlanId: "10" }, phone: "08012345678", reference: "local-ref" });
  assert.equal(result.providerReference, "DATA|TRANSACTION|123");
});
test("handles explicit failure and keeps ambiguous outcomes pending", async () => {
  const args = { plan: { network: "MTN", providerPlanId: "11" }, phone: "08012345678", reference: "local-ref" };
  global.fetch = async () => json({ status: "fail", msg: "Insufficient balance" }, 400);
  await assert.rejects(purchaseData(args), e => e.isFinalProviderFailure && !e.isProviderPending);
  global.fetch = async () => json({ status: "fail", msg: "Server error" }, 500);
  await assert.rejects(purchaseData(args), e => e.isProviderPending && !e.isFinalProviderFailure);
  global.fetch = async () => { throw new Error("timeout"); };
  await assert.rejects(purchaseData(args), e => e.isProviderPending && e.providerResponse.reference === "local-ref");
});
