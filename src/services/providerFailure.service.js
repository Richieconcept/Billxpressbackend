const extractTextValues = (value) => {
  if (value === null || value === undefined) return [];

  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractTextValues);
  }

  if (typeof value === "object") {
    return Object.values(value).flatMap(extractTextValues);
  }

  return [];
};

const PROVIDER_FUNDS_PATTERNS = [
  /fund\s+(your\s+)?wallet/i,
  /(insufficient|low|not enough)\s+(fund|funds|balance|wallet|account)/i,
  /(wallet|account)\s+(balance|funds?)\s+(is\s+)?(low|insufficient)/i,
  /top\s*up/i,
  /out\s+of\s+funds/i,
];

export const isProviderFundsError = (error) => {
  const text = [
    error?.message,
    ...extractTextValues(error?.providerResponse),
  ].join(" ");

  return PROVIDER_FUNDS_PATTERNS.some((pattern) => pattern.test(text));
};

export const getPublicProviderFailure = (error, serviceName) => {
  const service = serviceName || "Service";

  if (isProviderFundsError(error)) {
    return {
      code: "provider_insufficient_funds",
      statusCode: 503,
      message: `${service} is temporarily unavailable. Please try again later. Your wallet has been refunded.`,
    };
  }

  return {
    code: "provider_request_failed",
    statusCode: error?.statusCode || 502,
    message: `${service} could not be completed right now. Please try again later. Your wallet has been refunded.`,
  };
};
