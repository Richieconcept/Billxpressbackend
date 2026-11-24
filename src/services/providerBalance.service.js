const parseBalance = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") throw new Error("Provider did not return a balance");
  const normalized = String(value).replace(/[₦,\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) throw new Error("Provider returned an invalid balance");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Provider returned an invalid balance");
  return amount;
};
export const fetchProviderBalance = async ({ provider, baseUrl, path, key, method = "GET", field, success }) => {
  if (!key) throw new Error(provider + " API key is not configured");
  const response = await fetch(baseUrl.replace(/\/+$/, "") + path, {
    method, headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Token " + key },
    signal: AbortSignal.timeout(10000),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error("Invalid provider response"); }
  if (!response.ok || !success(data)) throw new Error(data?.message || data?.msg || "Provider balance request failed");
  return { provider, balance: parseBalance(data[field]), currency: "NGN", source: "live" };
};
export const fetchQuicklysimBalance = () => fetchProviderBalance({
  provider: "quicklysim", baseUrl: process.env.QUICKLYSIM_BASE_URL || "https://quicklysim.com",
  path: "/topupmate/api/user", key: process.env.QUICKLYSIM_API_KEY, field: "balance",
  success: (data) => Boolean(data && data.balance != null),
});
export const fetchUniteddata2Balance = () => fetchProviderBalance({
  provider: "uniteddata2", baseUrl: process.env.UNITEDDATA2_BASE_URL || "https://uniteddata2.com.ng",
  path: "/auth/userdetails.php", method: "POST", key: process.env.UNITEDDATA2_API_KEY, field: "WalletBalance",
  success: (data) => String(data?.success) === "1",
});
export { parseBalance };

export const extractSponsorBalance = (message) => {
  const match = typeof message === "string" ? message.match(/sponsor\s*balance\s*:\s*₦?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i) : null;
  return match ? parseBalance(match[1]) : null;
};
