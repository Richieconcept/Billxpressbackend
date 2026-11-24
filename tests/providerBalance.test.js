import test from "node:test";
import assert from "node:assert/strict";
import { parseBalance, extractSponsorBalance, fetchQuicklysimBalance, fetchUniteddata2Balance } from "../src/services/providerBalance.service.js";
test("balance parsing preserves zero and rejects missing or malformed values", () => {
  assert.equal(parseBalance("0.00"), 0); assert.equal(parseBalance("₦9,905.0"), 9905);
  for (const value of [null, "", "not available", -1]) assert.throws(() => parseBalance(value));
});
test("live balances use documented endpoints and never convert missing balances to zero", async () => {
  process.env.QUICKLYSIM_API_KEY = "test"; process.env.UNITEDDATA2_API_KEY = "test";
  global.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, "Token test");
    if (url.includes("quicklysim")) return new Response(JSON.stringify({balance:"1,234.50"}));
    return new Response(JSON.stringify({success:"1",WalletBalance:"0.00"}));
  };
  assert.equal((await fetchQuicklysimBalance()).balance, 1234.5);
  assert.equal((await fetchUniteddata2Balance()).balance, 0);
  global.fetch = async () => new Response(JSON.stringify({success:"1"}));
  await assert.rejects(fetchUniteddata2Balance(), /did not return a balance/);
});

test("extracts only the explicitly labeled sponsor balance", () => {
  assert.equal(extractSponsorBalance("Bundle N500. Sponsor Balance: 27,887.5"), 27887.5);
  assert.equal(extractSponsorBalance("Sponsor Balance: 0"), 0);
  assert.equal(extractSponsorBalance("Recharge NGN 500"), null);
});
