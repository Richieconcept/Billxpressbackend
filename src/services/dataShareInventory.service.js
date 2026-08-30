import DataShareBatch from "../models/dataShareBatch.model.js";
import DataShareSim from "../models/dataShareSim.model.js";
import DataShareUsage from "../models/dataShareUsage.model.js";

const MTN_NETWORK = "MTN";
const DATA_SHARE_TYPE = "DATA SHARE";

const normalizePhoneNumber = (value) =>
  String(value || "")
    .trim()
    .replace(/[^\d]/g, "");

const normalizeStatus = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const roundMoney = (value) => Number((Number(value) || 0).toFixed(2));

export const parseDataVolumeToMb = (value) => {
  const text = String(value || "")
    .replace(/,/g, "")
    .trim();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/i);

  if (!match) return 0;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (unit === "tb") return Math.round(amount * 1024 * 1024);
  if (unit === "gb") return Math.round(amount * 1024);
  return Math.round(amount);
};

const formatMb = (mb) => {
  const value = Number(mb) || 0;

  if (value >= 1024) {
    return `${roundMoney(value / 1024)}GB`;
  }

  return `${roundMoney(value)}MB`;
};

const parseProviderReportedRemainingMb = (response) => {
  const text = [
    response?.response,
    response?.message,
    response?.data?.response,
    response?.data?.message,
  ]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/Sponsor'?s?\s+New\s+Balance\s+([\d,.]+)\s*(tb|gb|mb)/i);

  if (!match) return null;

  return parseDataVolumeToMb(`${match[1]}${match[2]}`);
};

const extractHistory = (providerHistory) => providerHistory?.data || providerHistory || {};

export const isTwoFastMtnDataSharePlan = ({ providerName, plan }) =>
  providerName === "2fast" &&
  String(plan?.network || "").toUpperCase() === MTN_NETWORK &&
  String(plan?.type || "").toUpperCase() === DATA_SHARE_TYPE;

export const serializeDataShareSim = async (sim) => {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [stock, todayUsage, monthUsage] = await Promise.all([
    DataShareBatch.aggregate([
      { $match: { sim: sim._id, status: { $in: ["active", "exhausted"] } } },
      {
        $group: {
          _id: null,
          totalMb: { $sum: "$totalMb" },
          remainingMb: { $sum: "$remainingMb" },
          soldMb: { $sum: "$soldMb" },
          revenue: { $sum: "$revenue" },
          costSpent: { $sum: "$costSpent" },
          profit: { $sum: "$profit" },
        },
      },
    ]),
    DataShareUsage.aggregate([
      { $match: { sim: sim._id, status: "matched", createdAt: { $gte: dayStart } } },
      { $group: { _id: null, soldMb: { $sum: "$soldMb" }, count: { $sum: 1 } } },
    ]),
    DataShareUsage.aggregate([
      {
        $match: { sim: sim._id, status: "matched", createdAt: { $gte: monthStart } },
      },
      { $group: { _id: null, soldMb: { $sum: "$soldMb" }, count: { $sum: 1 } } },
    ]),
  ]);
  const stockSummary = stock[0] || {};
  const todaySummary = todayUsage[0] || {};
  const monthSummary = monthUsage[0] || {};

  return {
    id: sim._id,
    phoneNumber: sim.phoneNumber,
    label: sim.label,
    groupName: sim.groupName,
    activeFromDay: sim.activeFromDay,
    activeToDay: sim.activeToDay,
    dailyLimitMb: sim.dailyLimitMb,
    dailyLimit: formatMb(sim.dailyLimitMb),
    todaySharedMb: todaySummary.soldMb || 0,
    todayShared: formatMb(todaySummary.soldMb || 0),
    todayShareCount: todaySummary.count || 0,
    monthlyShareLimit: sim.monthlyShareLimit,
    monthShareCount: monthSummary.count || 0,
    monthSharedMb: monthSummary.soldMb || 0,
    monthShared: formatMb(monthSummary.soldMb || 0),
    remainingMb: stockSummary.remainingMb || 0,
    remaining: formatMb(stockSummary.remainingMb || 0),
    totalMb: stockSummary.totalMb || 0,
    total: formatMb(stockSummary.totalMb || 0),
    soldMb: stockSummary.soldMb || 0,
    sold: formatMb(stockSummary.soldMb || 0),
    revenue: roundMoney(stockSummary.revenue),
    costSpent: roundMoney(stockSummary.costSpent),
    profit: roundMoney(stockSummary.profit),
    status: sim.status,
    note: sim.note,
    createdAt: sim.createdAt,
    updatedAt: sim.updatedAt,
  };
};

export const serializeDataShareBatch = (batch) => ({
  id: batch._id,
  sim: batch.sim,
  simPhoneNumber: batch.simPhoneNumber,
  groupName: batch.groupName,
  network: batch.network,
  totalMb: batch.totalMb,
  total: formatMb(batch.totalMb),
  remainingMb: batch.remainingMb,
  remaining: formatMb(batch.remainingMb),
  soldMb: batch.soldMb,
  sold: formatMb(batch.soldMb),
  totalCost: roundMoney(batch.totalCost),
  costPerMb: batch.costPerMb,
  estimatedRemainingCost: roundMoney(batch.remainingMb * batch.costPerMb),
  revenue: roundMoney(batch.revenue),
  costSpent: roundMoney(batch.costSpent),
  profit: roundMoney(batch.profit),
  validity: batch.validity,
  activeFrom: batch.activeFrom,
  expiresAt: batch.expiresAt,
  status: batch.status,
  note: batch.note,
  createdAt: batch.createdAt,
  updatedAt: batch.updatedAt,
});

export const serializeDataShareUsage = (usage) => ({
  id: usage._id,
  transaction: usage.transaction,
  reference: usage.reference,
  provider: usage.provider,
  providerReference: usage.providerReference,
  batch: usage.batch,
  sim: usage.sim,
  simPhoneNumber: usage.simPhoneNumber,
  network: usage.network,
  volume: usage.volume,
  validity: usage.validity,
  soldMb: usage.soldMb,
  sold: formatMb(usage.soldMb),
  sellingPrice: roundMoney(usage.sellingPrice),
  costPrice: roundMoney(usage.costPrice),
  profit: roundMoney(usage.profit),
  providerReportedRemainingMb: usage.providerReportedRemainingMb,
  providerReportedRemaining:
    usage.providerReportedRemainingMb === null
      ? null
      : formatMb(usage.providerReportedRemainingMb),
  status: usage.status,
  providerResponse: usage.providerResponse,
  note: usage.note,
  createdAt: usage.createdAt,
  updatedAt: usage.updatedAt,
});

export const createDataShareSim = async ({ payload, adminUserId }) => {
  const phoneNumber = normalizePhoneNumber(payload?.phoneNumber);

  if (!phoneNumber) {
    const error = new Error("SIM phone number is required");
    error.statusCode = 400;
    throw error;
  }

  const sim = await DataShareSim.findOneAndUpdate(
    { phoneNumber },
    {
      $set: {
        label: payload?.label || "",
        groupName: payload?.groupName || "",
        activeFromDay: Number(payload?.activeFromDay || 1),
        activeToDay: Number(payload?.activeToDay || 10),
        dailyLimitMb: Number(payload?.dailyLimitMb || 5120),
        monthlyShareLimit: Number(payload?.monthlyShareLimit || 10),
        status: payload?.status || "active",
        note: payload?.note || "",
        updatedBy: adminUserId,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  return sim;
};

export const updateDataShareSim = async ({ simId, payload, adminUserId }) => {
  const allowedFields = [
    "label",
    "groupName",
    "activeFromDay",
    "activeToDay",
    "dailyLimitMb",
    "monthlyShareLimit",
    "status",
    "note",
  ];
  const update = {};

  allowedFields.forEach((field) => {
    if (payload?.[field] !== undefined) {
      update[field] = ["activeFromDay", "activeToDay", "dailyLimitMb", "monthlyShareLimit"].includes(field)
        ? Number(payload[field])
        : payload[field];
    }
  });

  const sim = await DataShareSim.findByIdAndUpdate(
    simId,
    { $set: { ...update, updatedBy: adminUserId } },
    { new: true, runValidators: true }
  );

  if (!sim) {
    const error = new Error("Datashare SIM was not found");
    error.statusCode = 404;
    throw error;
  }

  return sim;
};

export const listDataShareSims = async (filters = {}) => {
  const query = {};

  if (filters.status) query.status = filters.status;
  if (filters.groupName) query.groupName = filters.groupName;
  if (filters.phoneNumber) query.phoneNumber = normalizePhoneNumber(filters.phoneNumber);

  return DataShareSim.find(query).sort({ groupName: 1, phoneNumber: 1 });
};

export const createDataShareBatch = async ({ payload, adminUserId }) => {
  const phoneNumber = normalizePhoneNumber(payload?.simPhoneNumber || payload?.phoneNumber);
  const totalMb = payload?.totalMb
    ? Number(payload.totalMb)
    : parseDataVolumeToMb(payload?.totalData || payload?.volume);
  const totalCost = Number(payload?.totalCost);

  if (!phoneNumber || !totalMb || !Number.isFinite(totalCost) || totalCost < 0) {
    const error = new Error("SIM phone number, total data, and total cost are required");
    error.statusCode = 400;
    throw error;
  }

  const sim = await DataShareSim.findOne({ phoneNumber });

  if (!sim) {
    const error = new Error("Create the datashare SIM before adding stock");
    error.statusCode = 404;
    throw error;
  }

  const batch = await DataShareBatch.create({
    sim: sim._id,
    simPhoneNumber: sim.phoneNumber,
    groupName: payload?.groupName ?? sim.groupName,
    network: MTN_NETWORK,
    totalMb,
    remainingMb: payload?.remainingMb === undefined ? totalMb : Number(payload.remainingMb),
    totalCost,
    costPerMb: totalCost / totalMb,
    validity: payload?.validity || "",
    activeFrom: payload?.activeFrom ? new Date(payload.activeFrom) : null,
    expiresAt: payload?.expiresAt ? new Date(payload.expiresAt) : null,
    status: payload?.status || "active",
    note: payload?.note || "",
    createdBy: adminUserId,
    updatedBy: adminUserId,
  });

  return batch;
};

export const updateDataShareBatch = async ({ batchId, payload, adminUserId }) => {
  const allowedFields = ["status", "note", "expiresAt", "activeFrom", "validity"];
  const update = {};

  allowedFields.forEach((field) => {
    if (payload?.[field] !== undefined) {
      update[field] = ["expiresAt", "activeFrom"].includes(field) && payload[field]
        ? new Date(payload[field])
        : payload[field];
    }
  });

  const batch = await DataShareBatch.findByIdAndUpdate(
    batchId,
    { $set: { ...update, updatedBy: adminUserId } },
    { new: true, runValidators: true }
  );

  if (!batch) {
    const error = new Error("Datashare stock batch was not found");
    error.statusCode = 404;
    throw error;
  }

  return batch;
};

export const listDataShareBatches = async (filters = {}) => {
  const query = {};

  if (filters.status) query.status = filters.status;
  if (filters.groupName) query.groupName = filters.groupName;
  if (filters.phoneNumber || filters.simPhoneNumber) {
    query.simPhoneNumber = normalizePhoneNumber(
      filters.phoneNumber || filters.simPhoneNumber
    );
  }

  return DataShareBatch.find(query).sort({ status: 1, expiresAt: 1, createdAt: 1 });
};

export const listDataShareUsages = async (filters = {}) => {
  const query = {};

  if (filters.status) query.status = filters.status;
  if (filters.phoneNumber || filters.simPhoneNumber) {
    query.simPhoneNumber = normalizePhoneNumber(
      filters.phoneNumber || filters.simPhoneNumber
    );
  }
  if (filters.reference) query.reference = String(filters.reference).trim();

  return DataShareUsage.find(query).sort({ createdAt: -1 }).limit(200);
};

export const getDataShareInventorySummary = async () => {
  const [stock, usage, unmatchedCount, sims] = await Promise.all([
    DataShareBatch.aggregate([
      { $match: { status: { $in: ["active", "exhausted"] } } },
      {
        $group: {
          _id: null,
          totalMb: { $sum: "$totalMb" },
          remainingMb: { $sum: "$remainingMb" },
          soldMb: { $sum: "$soldMb" },
          totalCost: { $sum: "$totalCost" },
          revenue: { $sum: "$revenue" },
          costSpent: { $sum: "$costSpent" },
          profit: { $sum: "$profit" },
        },
      },
    ]),
    DataShareUsage.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 }, soldMb: { $sum: "$soldMb" } } },
    ]),
    DataShareUsage.countDocuments({ status: { $in: ["unmatched", "lookup_failed"] } }),
    DataShareSim.countDocuments({ status: "active" }),
  ]);
  const stockSummary = stock[0] || {};

  return {
    network: MTN_NETWORK,
    activeSimCount: sims,
    totalMb: stockSummary.totalMb || 0,
    total: formatMb(stockSummary.totalMb || 0),
    remainingMb: stockSummary.remainingMb || 0,
    remaining: formatMb(stockSummary.remainingMb || 0),
    soldMb: stockSummary.soldMb || 0,
    sold: formatMb(stockSummary.soldMb || 0),
    totalCost: roundMoney(stockSummary.totalCost),
    revenue: roundMoney(stockSummary.revenue),
    costSpent: roundMoney(stockSummary.costSpent),
    profit: roundMoney(stockSummary.profit),
    unmatchedCount,
    usageByStatus: usage.reduce((result, item) => {
      result[item._id] = {
        count: item.count,
        soldMb: item.soldMb,
        sold: formatMb(item.soldMb),
      };
      return result;
    }, {}),
  };
};

export const recordDataShareUsageFromTransaction = async ({
  transaction,
  pricedPlan,
  providerHistory,
}) => {
  const existingUsage = await DataShareUsage.findOne({
    transaction: transaction._id,
  });

  if (existingUsage?.status === "matched") {
    return {
      status: "matched",
      usage: existingUsage,
      costPrice: existingUsage.costPrice,
      profit: existingUsage.profit,
      providerReportedRemainingMb: existingUsage.providerReportedRemainingMb,
    };
  }

  const history = extractHistory(providerHistory);
  const status = normalizeStatus(history.status || providerHistory?.status);
  const route = normalizeStatus(history.route);
  const volume = history.volume || pricedPlan?.name || "";
  const soldMb = parseDataVolumeToMb(volume);
  const simPhoneNumber = normalizePhoneNumber(history.sender);
  const providerReportedRemainingMb =
    parseProviderReportedRemainingMb(history) ??
    parseProviderReportedRemainingMb(providerHistory);
  const sellingPrice = Number(pricedPlan?.sellingPrice || 0);

  if (status !== "success" || route !== "sim" || !soldMb || !simPhoneNumber) {
    const usage = await DataShareUsage.findOneAndUpdate(
      { transaction: transaction._id },
      {
        $set: {
          reference: transaction.reference,
          provider: "2fast",
          providerReference: transaction.providerReference || transaction.reference,
          network: MTN_NETWORK,
          volume,
          validity: history.validity || pricedPlan?.validity || "",
          soldMb,
          sellingPrice,
          status: "unmatched",
          providerReportedRemainingMb,
          providerResponse: providerHistory || {},
          note: "2Fast did not return successful SIM datashare history",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
      status: "unmatched",
      usage,
      costPrice: 0,
      profit: sellingPrice,
      providerReportedRemainingMb,
      reason: usage.note,
    };
  }

  const sim = await DataShareSim.findOne({ phoneNumber: simPhoneNumber });

  if (!sim) {
    const usage = await DataShareUsage.findOneAndUpdate(
      { transaction: transaction._id },
      {
        $set: {
          reference: transaction.reference,
          provider: "2fast",
          providerReference: transaction.providerReference || transaction.reference,
          simPhoneNumber,
          network: MTN_NETWORK,
          volume,
          validity: history.validity || pricedPlan?.validity || "",
          soldMb,
          sellingPrice,
          status: "unmatched",
          providerReportedRemainingMb,
          providerResponse: providerHistory || {},
          note: "Sender SIM has not been created in datashare inventory",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
      status: "unmatched",
      usage,
      costPrice: 0,
      profit: sellingPrice,
      providerReportedRemainingMb,
      reason: usage.note,
    };
  }

  const batch = await DataShareBatch.findOne({
    sim: sim._id,
    simPhoneNumber,
    status: "active",
    remainingMb: { $gte: soldMb },
    $or: [{ expiresAt: null }, { expiresAt: { $gte: new Date() } }],
  }).sort({ activeFrom: 1, expiresAt: 1, createdAt: 1 });

  if (!batch) {
    const usage = await DataShareUsage.findOneAndUpdate(
      { transaction: transaction._id },
      {
        $set: {
          reference: transaction.reference,
          provider: "2fast",
          providerReference: transaction.providerReference || transaction.reference,
          sim: sim._id,
          simPhoneNumber,
          network: MTN_NETWORK,
          volume,
          validity: history.validity || pricedPlan?.validity || "",
          soldMb,
          sellingPrice,
          status: "unmatched",
          providerReportedRemainingMb,
          providerResponse: providerHistory || {},
          note: "No active stock batch has enough remaining data for this SIM",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
      status: "unmatched",
      usage,
      costPrice: 0,
      profit: sellingPrice,
      providerReportedRemainingMb,
      reason: usage.note,
    };
  }

  const costPrice = roundMoney(soldMb * batch.costPerMb);
  const profit = roundMoney(sellingPrice - costPrice);
  const updatedBatch = await DataShareBatch.findByIdAndUpdate(
    batch._id,
    {
      $inc: {
        remainingMb: -soldMb,
        soldMb,
        revenue: sellingPrice,
        costSpent: costPrice,
        profit,
      },
      $set: { updatedBy: transaction.user },
    },
    { new: true }
  );

  if (updatedBatch.remainingMb <= 0 && updatedBatch.status === "active") {
    updatedBatch.status = "exhausted";
    await updatedBatch.save();
  }

  const usage = await DataShareUsage.findOneAndUpdate(
    { transaction: transaction._id },
    {
      $set: {
        reference: transaction.reference,
        provider: "2fast",
        providerReference: transaction.providerReference || transaction.reference,
        batch: batch._id,
        sim: sim._id,
        simPhoneNumber,
        network: MTN_NETWORK,
        volume,
        validity: history.validity || pricedPlan?.validity || "",
        soldMb,
        sellingPrice,
        costPrice,
        profit,
        providerReportedRemainingMb,
        status: "matched",
        providerResponse: providerHistory || {},
        note: "",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    status: "matched",
    usage,
    batch: updatedBatch,
    sim,
    costPrice,
    profit,
    providerReportedRemainingMb,
  };
};
