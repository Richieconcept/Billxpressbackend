export const sanitizeUser = (user, options = {}) => {
  const source = typeof user.toObject === "function" ? user.toObject() : user;
  const sanitized = {
    id: source._id,
    firstName: source.firstName,
    lastName: source.lastName,
    username: source.username,
    email: source.email,
    phone: source.phone,
    role: source.role,
    discountRate: source.discountRate ?? 0,
    isVendorActive: source.isVendorActive ?? false,
    vendorApprovedAt: source.vendorApprovedAt,
    referralCode: source.referralCode,
    referredBy: source.referredBy,
    isActive: source.isActive,
    emailVerified: source.emailVerified,
    authTier: source.authTier || "tier_1",
    kycLevel: source.kycLevel ?? 0,
    createdAt: source.createdAt,
  };

  if (options.includeApiKey && source.role === "vendor") {
    sanitized.apiKey = source.apiKey || null;
  }

  return sanitized;
};
