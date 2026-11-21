import test from "node:test";
import assert from "node:assert/strict";
import { fetchPlans, purchaseData } from "../src/services/dataProviders/quicklysim.provider.js";
process.env.QUICKLYSIM_API_KEY = "test-key";
test("maps supported networks and prices", async () => {
  global.fetch = async () => new Response(JSON.stringify(["MTN","GLO","AIRTEL","9MOBILE"].map((network,i)=>({network,plan_id:i+1,plan_name:"1GB",network_type:"GIFTING",price:"205",validate:"30 days"}))));
  const plans = await fetchPlans();
  assert.deepEqual(plans.map(p=>p.networkCode),["1","2","4"]);
  assert.equal(plans[0].providerPrice,205);
});
test("purchase uses correct network and idempotency reference", async () => {
  global.fetch = async (url, options) => {
    assert.match(url,/topupmate\/api\/data$/);
    assert.equal(options.headers.Authorization,"Token test-key");
    assert.deepEqual(JSON.parse(options.body),{network:"4",mobile_number:"08012345678",plan:421,ref:"ref123",ported_number:false});
    return new Response(JSON.stringify({status:"success"}));
  };
  assert.equal((await purchaseData({plan:{network:"AIRTEL",providerPlanCode:"421"},phone:"08012345678",reference:"ref123"})).providerReference,"ref123");
});
test("uncertain requests stay pending; explicit failures are final", async () => {
  const args={plan:{network:"MTN",providerPlanCode:"421"},phone:"08012345678",reference:"ref123"};
  global.fetch=async()=>{throw new Error("timeout")};
  await assert.rejects(purchaseData(args),e=>e.isProviderPending && e.providerResponse.reference==="ref123");
  global.fetch=async()=>new Response(JSON.stringify({status:"fail",true_response:"Insufficient account balance"}));
  await assert.rejects(purchaseData(args),e=>e.isFinalProviderFailure && !e.isProviderPending);
});
