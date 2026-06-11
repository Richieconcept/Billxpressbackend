import Transaction from "../models/transaction.model.js";

export const normalizeCustomerReference = (customerReference) =>
  String(customerReference || "").trim();

export const ensureUniqueCustomerReference = async ({
  userId,
  customerReference,
}) => {
  const normalizedCustomerReference =
    normalizeCustomerReference(customerReference);

  if (!normalizedCustomerReference) {
    return null;
  }

  const existingTransaction = await Transaction.findOne({
    user: userId,
    "metadata.customerReference": normalizedCustomerReference,
  });

  if (existingTransaction) {
    const error = new Error("customerReference has already been used");
    error.statusCode = 409;
    error.code = "DUPLICATE_REFERENCE";
    error.transaction = existingTransaction;
    throw error;
  }

  return normalizedCustomerReference;
};
