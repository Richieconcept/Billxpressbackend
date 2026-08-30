import {
  createDataShareBatch,
  createDataShareSim,
  getDataShareInventorySummary,
  listDataShareBatches,
  listDataShareSims,
  listDataShareUsages,
  serializeDataShareBatch,
  serializeDataShareSim,
  serializeDataShareUsage,
  updateDataShareBatch,
  updateDataShareSim,
} from "../services/dataShareInventory.service.js";

const sendDataShareInventoryError = (res, publicMessage, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : publicMessage,
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
};

export const getAdminDataShareSummary = async (req, res) => {
  try {
    res.json({ summary: await getDataShareInventorySummary() });
  } catch (error) {
    sendDataShareInventoryError(
      res,
      "Could not fetch datashare inventory summary",
      error
    );
  }
};

export const getAdminDataShareSims = async (req, res) => {
  try {
    const sims = await listDataShareSims(req.query || {});
    const serialized = await Promise.all(sims.map(serializeDataShareSim));

    res.json({ sims: serialized, count: serialized.length });
  } catch (error) {
    sendDataShareInventoryError(res, "Could not fetch datashare SIMs", error);
  }
};

export const createAdminDataShareSim = async (req, res) => {
  try {
    const sim = await createDataShareSim({
      payload: req.body || {},
      adminUserId: req.user._id,
    });

    res.status(201).json({
      message: "Datashare SIM saved successfully",
      sim: await serializeDataShareSim(sim),
    });
  } catch (error) {
    sendDataShareInventoryError(res, "Could not save datashare SIM", error);
  }
};

export const updateAdminDataShareSim = async (req, res) => {
  try {
    const sim = await updateDataShareSim({
      simId: req.params.simId,
      payload: req.body || {},
      adminUserId: req.user._id,
    });

    res.json({
      message: "Datashare SIM updated successfully",
      sim: await serializeDataShareSim(sim),
    });
  } catch (error) {
    sendDataShareInventoryError(res, "Could not update datashare SIM", error);
  }
};

export const getAdminDataShareBatches = async (req, res) => {
  try {
    const batches = await listDataShareBatches(req.query || {});

    res.json({
      batches: batches.map(serializeDataShareBatch),
      count: batches.length,
    });
  } catch (error) {
    sendDataShareInventoryError(res, "Could not fetch datashare stock", error);
  }
};

export const createAdminDataShareBatch = async (req, res) => {
  try {
    const batch = await createDataShareBatch({
      payload: req.body || {},
      adminUserId: req.user._id,
    });

    res.status(201).json({
      message: "Datashare stock added successfully",
      batch: serializeDataShareBatch(batch),
    });
  } catch (error) {
    sendDataShareInventoryError(res, "Could not add datashare stock", error);
  }
};

export const updateAdminDataShareBatch = async (req, res) => {
  try {
    const batch = await updateDataShareBatch({
      batchId: req.params.batchId,
      payload: req.body || {},
      adminUserId: req.user._id,
    });

    res.json({
      message: "Datashare stock updated successfully",
      batch: serializeDataShareBatch(batch),
    });
  } catch (error) {
    sendDataShareInventoryError(res, "Could not update datashare stock", error);
  }
};

export const getAdminDataShareUsages = async (req, res) => {
  try {
    const usages = await listDataShareUsages(req.query || {});

    res.json({
      usages: usages.map(serializeDataShareUsage),
      count: usages.length,
    });
  } catch (error) {
    sendDataShareInventoryError(res, "Could not fetch datashare usage", error);
  }
};
