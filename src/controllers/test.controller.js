import { sanitizeUser } from "../utils/sanitizeUser.js";

export const getTestUser = (req, res) => {
  res.json({
    message: "JWT authentication successful",
    user: sanitizeUser(req.user),
  });
};

export const getTestVendor = (req, res) => {
  res.json({
    message: "Vendor API key authentication successful",
    user: sanitizeUser(req.user),
  });
};
