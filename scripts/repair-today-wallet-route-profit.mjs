import dotenv from "dotenv";
import mongoose from "mongoose";
import Transaction from "../src/models/transaction.model.js";

dotenv.config();

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

const startDate = new Date("2026-08-31T23:00:00.000Z");
const endDate = new Date("2026-09-01T23:00:00.000Z");

const getRequiredEnv = (name) => {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
};

const getTwoFastBaseUrl = () =>
  String(process.env.TWOFAST_BASE_URL || "https://2fast.com.ng/api").replace(
    /\/+$/,
    ""
  );

const fetchTwoFastTransactionHistory = async (reference) => {
  const response = await fetch(`${getTwoFastBaseUrl()}/transaction-history`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${getRequiredEnv("TWOFAST_CONTRACT_ID")}`,
    },
    body: JSON.stringify({ reference }),
  });
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.error || "2Fast history lookup failed");
  }

  return data;
};

const extractProviderHistory = (providerHistory) =>
  providerHistory?.data || providerHistory || {};

const getWalletRouteHistory = (metadata) =>
  extractProviderHistory(
    metadata.providerHistory ||
      metadata.providerResponse ||
      metadata.dataShareInventory?.providerResponse
  );

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const toMoneyNumber = (value) => {
  const number = Number(String(value ?? "").replace(/[,\s]/g, ""));

  return Number.isFinite(number) && number > 0 ? number : 0;
};

const findPositiveMoneyValue = (source, keys = []) => {
  if (!source || typeof source !== "object") {
    return 0;
  }

  for (const key of keys) {
    const value = toMoneyNumber(source[key]);

    if (value > 0) {
      return value;
    }
  }

  return 0;
};

const extractWalletRouteCost = (metadata) => {
  const history = getWalletRouteHistory(metadata);
  const directCost = findPositiveMoneyValue(history, [
    "buyingPrice",
    "buying_price",
    "buying price",
    "costPrice",
    "cost_price",
    "providerPrice",
    "provider_price",
  ]);

  if (directCost > 0) {
    return directCost;
  }

  const text = [
    history.response,
    history.message,
    metadata.providerHistory?.response,
    metadata.providerHistory?.message,
    metadata.providerResponse?.response,
    metadata.providerResponse?.message,
    metadata.dataShareInventory?.providerResponse?.response,
    metadata.dataShareInventory?.providerResponse?.message,
  ]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/\bbuying\s+price\s+([\d,.]+)/i);

  if (match) {
    return toMoneyNumber(match[1]);
  }

  return toMoneyNumber(metadata.plan?.providerPrice);
};

const getRoute = (metadata) => {
  const history = getWalletRouteHistory(metadata);
  const route = normalizeText(history.route);

  if (route) {
    return route;
  }

  const text = [
    history.response,
    history.message,
    metadata.providerHistory?.response,
    metadata.providerHistory?.message,
    metadata.providerResponse?.response,
    metadata.providerResponse?.message,
    metadata.dataShareInventory?.providerResponse?.response,
    metadata.dataShareInventory?.providerResponse?.message,
  ]
    .filter(Boolean)
    .join(" ");

  return /\broute\s+(?:is\s+)?wallet\b/i.test(text) ? "wallet" : "";
};

const getHistoryReference = (transaction) =>
  transaction.providerReference || transaction.reference;

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const transactions = await Transaction.find({
    type: "service_payment",
    direction: "debit",
    status: "successful",
    provider: "2fast",
    "metadata.service": "data",
    createdAt: { $gte: startDate, $lt: endDate },
  }).sort({ createdAt: 1 });

  const candidates = [];
  const skipped = {
    notWalletRoute: 0,
    missingBuyingPrice: 0,
    alreadyCorrect: 0,
    historyLookupFailed: 0,
  };
  const routeBreakdown = {};

  for (const transaction of transactions) {
    let metadata = transaction.metadata || {};
    let fetchedProviderHistory = null;
    let route = getRoute(metadata);

    if (!route) {
      try {
        fetchedProviderHistory = await fetchTwoFastTransactionHistory(
          getHistoryReference(transaction)
        );
        metadata = {
          ...metadata,
          providerHistory: fetchedProviderHistory,
        };
        route = getRoute(metadata);
      } catch {
        skipped.historyLookupFailed += 1;
      }
    }

    routeBreakdown[route || "unknown"] =
      (routeBreakdown[route || "unknown"] || 0) + 1;

    if (route !== "wallet") {
      skipped.notWalletRoute += 1;
      continue;
    }

    const costPrice = extractWalletRouteCost(metadata);

    if (costPrice <= 0) {
      skipped.missingBuyingPrice += 1;
      continue;
    }

    const sellingPrice = Number(metadata.sellingPrice || transaction.amount / 100);
    const profit = Math.max(0, Number((sellingPrice - costPrice).toFixed(2)));
    const currentCostPrice = Number(metadata.costPrice || 0);
    const currentProfit = Number(metadata.profit || 0);

    if (currentCostPrice === costPrice && currentProfit === profit) {
      skipped.alreadyCorrect += 1;
      continue;
    }

    candidates.push({
      transaction,
      reference: transaction.reference,
      createdAt: transaction.createdAt,
      sellingPrice,
      previousCostPrice: currentCostPrice,
      correctedCostPrice: costPrice,
      previousProfit: currentProfit,
      correctedProfit: profit,
      profitDifference: Number((profit - currentProfit).toFixed(2)),
      providerHistory: fetchedProviderHistory,
    });
  }

  if (apply) {
    for (const item of candidates) {
      const metadata = item.transaction.metadata || {};

      item.transaction.metadata = {
        ...metadata,
        ...(item.providerHistory ? { providerHistory: item.providerHistory } : {}),
        costPrice: item.correctedCostPrice,
        costSource: "provider_wallet",
        profit: item.correctedProfit,
        plan: {
          ...metadata.plan,
          costPrice: item.correctedCostPrice,
          costSource: "provider_wallet",
          profit: item.correctedProfit,
        },
        dataShareInventory: {
          ...(metadata.dataShareInventory || {}),
          status: "provider_wallet",
          route: "wallet",
          costPrice: item.correctedCostPrice,
          sellingPrice: item.sellingPrice,
          profit: item.correctedProfit,
        },
        walletRouteProfitRepairedAt: new Date(),
      };

      await item.transaction.save();
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        date: "2026-09-01",
        timezone: "Africa/Lagos",
        windowUtc: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
        scanned: transactions.length,
        repairable: candidates.length,
        skipped,
        routeBreakdown,
        totalProfitAdjustment: Number(
          candidates
            .reduce((sum, item) => sum + item.profitDifference, 0)
            .toFixed(2)
        ),
        candidates: candidates.map((item) => ({
          reference: item.reference,
          createdAt: item.createdAt,
          sellingPrice: item.sellingPrice,
          previousCostPrice: item.previousCostPrice,
          correctedCostPrice: item.correctedCostPrice,
          previousProfit: item.previousProfit,
          correctedProfit: item.correctedProfit,
          profitDifference: item.profitDifference,
        })),
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
