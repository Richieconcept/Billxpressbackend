import dotenv from "dotenv";
import mongoose from "mongoose";
import DataShareBatch from "../src/models/dataShareBatch.model.js";
import DataShareUsage from "../src/models/dataShareUsage.model.js";

dotenv.config();

const apply = process.argv.includes("--apply");

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const batches = await DataShareBatch.find({})
    .select("_id simPhoneNumber totalMb remainingMb soldMb totalCost status createdAt")
    .sort({ createdAt: 1 })
    .lean();
  const batchIds = batches.map((batch) => batch._id);
  const linkedUsageCount = await DataShareUsage.countDocuments({
    batch: { $in: batchIds },
  });

  let deletedCount = 0;

  if (apply && batchIds.length > 0) {
    const result = await DataShareBatch.deleteMany({ _id: { $in: batchIds } });
    deletedCount = result.deletedCount || 0;
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        stockBatchCount: batches.length,
        linkedUsageCount,
        deletedCount,
        note: apply
          ? "Deleted all DataShare stock batches. SIM records and usage/transaction history were not deleted."
          : "Dry run only. Re-run with --apply to delete all DataShare stock batches.",
        batches: batches.map((batch) => ({
          id: batch._id,
          simPhoneNumber: batch.simPhoneNumber,
          totalMb: batch.totalMb,
          remainingMb: batch.remainingMb,
          soldMb: batch.soldMb,
          totalCost: batch.totalCost,
          status: batch.status,
          createdAt: batch.createdAt,
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
