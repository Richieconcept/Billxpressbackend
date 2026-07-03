const PROVIDER = "smeapi";
const NETWORK_CODES = {
  MTN: "1",
  AIRTEL: "2",
  GLO: "3",
  "9MOBILE": "4",
};

const getBaseUrl = () =>
  (process.env.SMEAPI_BASE_URL || "https://smeapi.com.ng/api").replace(
    /\/+$/,
    ""
  );

const getDashboardBaseUrl = () =>
  (
    process.env.SMEAPI_DASHBOARD_BASE_URL || "https://smeapi.com.ng/auth/dashboard"
  ).replace(/\/+$/, "");

const toNumber = (value) => {
  const numericValue = Number(String(value || "").replace(/,/g, ""));

  return Number.isFinite(numericValue) ? numericValue : 0;
};

const isOn = (value) => String(value || "").toLowerCase() === "on";

const getPlanTypeStatus = (plan) => {
  const type = String(plan.type || "").toLowerCase();

  if (type.includes("sme2")) return plan.sme2Status;
  if (type.includes("sme")) return plan.smeStatus;
  if (type.includes("gifting")) return plan.giftingStatus;
  if (type.includes("corporate2")) return plan.corporate2Status;
  if (type.includes("corporate")) return plan.corporateStatus;
  if (type.includes("coupon")) return plan.couponStatus;
  if (type.includes("vtu")) return plan.vtuStatus;
  if (type.includes("share")) return plan.shareStatus || plan.sharesellStatus;
  if (type.includes("pin")) return plan.datapinStatus;

  return undefined;
};

const isPlanAvailable = (plan) => {
  if (!isOn(plan.networkStatus)) return false;

  const typeStatus = getPlanTypeStatus(plan);
  return typeStatus === undefined ? true : isOn(typeStatus);
};

const getCostPrice = (plan) => {
  const priceCandidates = [
    plan.apiprice,
    plan.api_price,
    plan.vendorprice,
    plan.vendor_price,
    plan.agentprice,
    plan.agent_price,
    plan.userprice,
    plan.user_price,
    plan.price,
  ]
    .map(toNumber)
    .filter((price) => price > 0);

  return priceCandidates[0] || 0;
};

const getRequiredEnv = (name) => {
  const value = process.env[name];

  if (!value) {
    const error = new Error(`${name} is not configured`);
    error.statusCode = 503;
    throw error;
  }

  return value;
};

const createCookieJar = () => {
  const cookies = new Map();

  return {
    header() {
      return Array.from(cookies.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
    },
    store(response) {
      response.headers.getSetCookie?.().forEach((cookie) => {
        const [pair] = cookie.split(";");
        const [key, value] = pair.split("=");
        if (key && value) cookies.set(key.trim(), value.trim());
      });

      const fallbackCookie = response.headers.get("set-cookie");
      if (fallbackCookie) {
        fallbackCookie.split(/,(?=[^;,]+=)/).forEach((cookie) => {
          const [pair] = cookie.split(";");
          const [key, value] = pair.split("=");
          if (key && value) cookies.set(key.trim(), value.trim());
        });
      }
    },
  };
};

const requestSmeApi = async (path, options = {}) => {
  const apiKey = getRequiredEnv("SMEAPI_API_KEY");
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    Authorization: `Token ${apiKey}`,
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
    const error = new Error(
      data?.message || data?.msg || data?.error || "SMEAPI request failed"
    );
    error.statusCode = 502;
    error.providerResponse = data;
    error.isFinalProviderFailure =
      response.status >= 400 &&
      response.status < 500 &&
      isConfirmedFailureResponse(data);
    throw error;
  }

  return data;
};

const loginToDashboard = async () => {
  const email = getRequiredEnv("SMEAPI_LOGIN_EMAIL");
  const password = getRequiredEnv("SMEAPI_LOGIN_PASSWORD");
  const jar = createCookieJar();
  const form = new URLSearchParams({ email, password });

  const response = await fetch(
    `${getDashboardBaseUrl()}/includes/route.php?login`,
    {
      method: "POST",
      body: form,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  jar.store(response);

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok || data?.status !== "success") {
    const error = new Error(data?.msg || "Could not login to SMEAPI dashboard");
    error.statusCode = 502;
    error.providerResponse = data;
    throw error;
  }

  return jar;
};

const extractPlansFromDashboard = (html) => {
  const blockMatch = html.match(
    /\/\/ Data Plan Management[\s\S]*?let plans = '([\s\S]*?)';/
  );

  if (!blockMatch) {
    const error = new Error("Could not read SMEAPI data plans");
    error.statusCode = 502;
    throw error;
  }

  try {
    return JSON.parse(blockMatch[1]);
  } catch (parseError) {
    const error = new Error("Could not parse SMEAPI data plans");
    error.statusCode = 502;
    error.cause = parseError;
    throw error;
  }
};

export const fetchPlans = async () => {
  const response = await requestSmeApi("/dataplans/");
  const plans = Array.isArray(response?.data) ? response.data : [];

  return plans.map((plan) => ({
    provider: PROVIDER,
    providerPlanId: String(plan.id || plan.pId || plan.planid || ""),
    providerPlanCode: String(plan.id || plan.planid || plan.pId || ""),
    network: String(plan.network || "").toUpperCase(),
    networkCode: String(
      plan.datanetwork ||
        plan.networkid ||
        NETWORK_CODES[String(plan.network || "").toUpperCase()] ||
        ""
    ),
    name: String(plan.name || ""),
    type: String(plan.type || ""),
    validity: plan.days || (plan.day ? String(plan.day) : null),
    validityDays: toNumber(
      String(plan.days || plan.day || "").match(/\d+/)?.[0]
    ),
    networkPrice: toNumber(plan.user_price),
    providerPrice: getCostPrice(plan),
    costPrice: getCostPrice(plan),
    available:
      plan.networkStatus === undefined ? true : isPlanAvailable(plan),
    raw: plan,
  }));
};

const isSuccessfulPurchase = (response) => {
  const status = String(response?.status || response?.Status || "").toLowerCase();
  const message = String(
    response?.message || response?.msg || response?.description || ""
  ).toLowerCase();

  return status === "success" || status === "successful" || message.includes("successful");
};

const isPendingPurchase = (response) => {
  const text = [
    response?.status,
    response?.Status,
    response?.message,
    response?.msg,
    response?.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(pending|processing|queued|in progress|initiated)\b/.test(text);
};

const isConfirmedFailureResponse = (response) => {
  const text = [
    response?.status,
    response?.Status,
    response?.message,
    response?.msg,
    response?.description,
    response?.error,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    /\b(failed|fail|declined|rejected|cancelled|canceled)\b/.test(text) ||
    /\b(invalid|incorrect|not available|unavailable|disabled)\b/.test(text) ||
    /\b(insufficient|low|fund wallet|top up|out of funds|balance)\b/.test(text)
  );
};

const buildPurchasePayloads = ({ plan, phone }) => [
  {
    network: String(plan.networkCode),
    phone,
    dataplan: String(plan.providerPlanId),
    ported_number: false,
  },
  {
    network: String(plan.networkCode),
    mobile_number: phone,
    plan: String(plan.providerPlanId),
    Ported_number: false,
  },
];

export const purchaseData = async ({ plan, phone, reference }) => {
  const payloads = buildPurchasePayloads({ plan, phone });
  let lastError = null;

  for (const payload of payloads) {
    try {
      const response = await requestSmeApi("/data/", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!isSuccessfulPurchase(response)) {
        const error = new Error(
          response?.message || response?.msg || "Data purchase failed"
        );
        error.statusCode = 502;
        error.providerResponse = response;
        error.isProviderPending = isPendingPurchase(response);
        error.isFinalProviderFailure =
          !error.isProviderPending && isConfirmedFailureResponse(response);
        throw error;
      }

      return {
        provider: PROVIDER,
        providerReference:
          response.transaction_id ||
          response.transactionId ||
          response.reference ||
          response.ident ||
          reference,
        message: response.message || response.msg || "Data purchase successful",
        raw: response,
        requestPayload: payload,
      };
    } catch (error) {
      lastError = error;

      if (error.isFinalProviderFailure !== true) {
        throw error;
      }
    }
  }

  throw lastError;
};

export const checkTransactionStatus = async (providerReference) =>
  requestSmeApi(`/transaction/${encodeURIComponent(providerReference)}`);

export const fetchBalance = async () => {
  const response = await requestSmeApi("/user/");

  return {
    provider: PROVIDER,
    accountName: response.name || null,
    balance: toNumber(response.balance),
    currency: "NGN",
    status: response.status || null,
    raw: response,
  };
};

export default {
  name: PROVIDER,
  fetchPlans,
  purchaseData,
  checkTransactionStatus,
  fetchBalance,
};
