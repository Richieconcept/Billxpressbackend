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

const PLAN_UNAVAILABLE_PATTERNS = [
  /(data\s*)?plan\s+(is\s+)?(not\s+)?(available|active|enabled)/i,
  /(data\s*)?plan\s+(is\s+)?(disabled|inactive|unavailable)/i,
  /(could\s+not\s+find|no|invalid|incorrect)\s+(data\s*)?plans?/i,
  /(selected|requested)\s+(data\s*)?plan\s+(could\s+not\s+be\s+found|is\s+not\s+available)/i,
  /package\s+(is\s+)?(not\s+)?(available|active|enabled)/i,
  /service\s+(is\s+)?(not\s+)?available\s+for\s+this\s+plan/i,
];

const INVALID_RECIPIENT_PATTERNS = [
  /(invalid|incorrect|wrong)\s+(phone|mobile|msisdn|number|recipient|beneficiary)/i,
  /(phone|mobile|msisdn|number|recipient|beneficiary)\s+(is\s+)?(invalid|incorrect|wrong)/i,
  /(phone|mobile|msisdn|number)\s+must\s+be/i,
  /(recipient|beneficiary)\s+(could\s+not\s+be\s+verified|not\s+found)/i,
  /(invalid|incorrect|wrong)\s+(customer|subscriber)/i,
  /(customer|subscriber)\s+(is\s+)?(invalid|incorrect|wrong|not\s+found)/i,
  /invalid\s+billers?\s*code/i,
  /wrong\s+billers?\s*code/i,
];

const INELIGIBLE_RECIPIENT_PATTERNS = [
  /(not|isn't|is\s+not)\s+eligible/i,
  /ineligible/i,
  /(line|number|recipient|customer)\s+(is\s+)?(not\s+)?eligible/i,
  /(cannot|can't|unable\s+to)\s+(receive|subscribe|buy|purchase)/i,
  /not\s+qualified/i,
  /not\s+allowed\s+for\s+this\s+(line|number|customer|plan)/i,
  /(plan|package|bundle)\s+(is\s+)?(not\s+)?(allowed|supported)\s+for\s+this\s+(line|number|customer|subscriber)/i,
  /(line|number|customer|subscriber)\s+(cannot|can't)\s+(receive|use)\s+this\s+(plan|package|bundle)/i,
  /not\s+available\s+on\s+this\s+(line|number|customer|subscriber)/i,
  /(plan|package|bundle)\s+(is\s+)?not\s+available\s+for\s+this\s+(line|number|customer|subscriber)/i,
  /(line|number|customer|subscriber)\s+(is\s+)?not\s+allowed\s+to\s+(use|buy|purchase|subscribe\s+to)\s+this\s+(plan|package|bundle)/i,
];

const MINIMUM_AMOUNT_PATTERNS = [
  /minimum\s+(purchase\s+)?amount/i,
  /amount\s+(is\s+)?(below|less\s+than)\s+(the\s+)?minimum/i,
  /minimum\s+(airtime|electricity|vend|vending|payment)/i,
  /min[_\s-]?(purchase[_\s-]?)?amount/i,
];

const INVALID_METER_PATTERNS = [
  /(invalid|incorrect|wrong)\s+(meter|meter\s+number|account\s+number)/i,
  /(meter|meter\s+number|account\s+number)\s+(is\s+)?(invalid|incorrect|wrong|not\s+found)/i,
  /(could\s+not|cannot|can't|unable\s+to)\s+verify\s+(meter|account)/i,
  /meter\s+validation\s+failed/i,
  /wrongbillerscode/i,
];

const INVALID_SMARTCARD_PATTERNS = [
  /(invalid|incorrect|wrong)\s+(smartcard|decoder|iuc|card\s+number)/i,
  /(smartcard|decoder|iuc|card\s+number)\s+(is\s+)?(invalid|incorrect|wrong|not\s+found)/i,
  /(could\s+not|cannot|can't|unable\s+to)\s+verify\s+(smartcard|decoder|iuc)/i,
  /smartcard\s+validation\s+failed/i,
];

const TEMPORARY_PROVIDER_PATTERNS = [
  /temporarily\s+unavailable/i,
  /try\s+again\s+(later|after|shortly|sometime)/i,
  /currently\s+unable\s+to\s+process/i,
  /service\s+timeout/i,
  /timed?\s*out/i,
  /network\s+(error|issue|busy|unavailable)/i,
  /provider\s+(error|issue|unavailable)/i,
];

const DUPLICATE_REFERENCE_PATTERNS = [
  /duplicate\s+(reference|transaction)/i,
  /(reference|transaction)\s+already\s+(exists|used|processed)/i,
];

const getProviderFailureText = (error) =>
  [
    error?.message,
    ...extractTextValues(error?.providerResponse),
  ].join(" ");

const matchesAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const getServiceKey = (serviceName = "") =>
  String(serviceName).toLowerCase().replace(/[^a-z]/g, "_");

const extractMinimumAmount = (text) => {
  const matches = [
    ...String(text || "").matchAll(
      /(?:minimum|min(?:imum)?(?:[_\s-]?purchase)?(?:[_\s-]?amount)?)[^\d]{0,20}(\d+(?:,\d{3})*(?:\.\d+)?)/gi
    ),
  ];
  const numericValue = matches
    .map((match) => Number(String(match[1]).replace(/,/g, "")))
    .find((value) => Number.isFinite(value) && value > 0);

  return numericValue || null;
};

const formatAmount = (amount) =>
  Number.isFinite(Number(amount))
    ? `NGN ${Number(amount).toLocaleString("en-NG")}`
    : "the required minimum amount";

export const isProviderFundsError = (error) => {
  const text = getProviderFailureText(error);

  return matchesAny(text, PROVIDER_FUNDS_PATTERNS);
};

export const getPublicProviderFailure = (error, serviceName) => {
  const service = serviceName || "Service";
  const serviceKey = getServiceKey(serviceName);
  const text = getProviderFailureText(error);
  const refundSuffix = " Your wallet has been refunded.";

  if (matchesAny(text, MINIMUM_AMOUNT_PATTERNS)) {
    const minimumAmount = extractMinimumAmount(text);

    return {
      code: "minimum_amount_not_met",
      statusCode: 400,
      message: `The amount is below the minimum allowed for this purchase. Please enter at least ${formatAmount(minimumAmount)}.${refundSuffix}`,
    };
  }

  if (serviceKey.includes("electricity") && matchesAny(text, INVALID_METER_PATTERNS)) {
    return {
      code: "invalid_meter",
      statusCode: 400,
      message: `The meter number could not be verified. Please check the meter number, disco, and meter type, then try again.${refundSuffix}`,
    };
  }

  if (serviceKey.includes("cable") && matchesAny(text, INVALID_SMARTCARD_PATTERNS)) {
    return {
      code: "invalid_smartcard",
      statusCode: 400,
      message: `The smartcard number could not be verified. Please check the TV provider and smartcard number, then try again.${refundSuffix}`,
    };
  }

  if (matchesAny(text, INVALID_RECIPIENT_PATTERNS)) {
    if (serviceKey.includes("airtime")) {
      return {
        code: "invalid_recipient",
        statusCode: 400,
        message: `The phone number is invalid or cannot receive airtime. Please check the number and network, then try again.${refundSuffix}`,
      };
    }

    if (serviceKey.includes("data")) {
      return {
        code: "invalid_recipient",
        statusCode: 400,
        message: `The phone number is invalid for this data purchase. Please check the number and try again.${refundSuffix}`,
      };
    }

    return {
      code: "invalid_recipient",
      statusCode: 400,
      message: `The recipient number is invalid. Please check the number and try again.${refundSuffix}`,
    };
  }

  if (matchesAny(text, INELIGIBLE_RECIPIENT_PATTERNS)) {
    if (serviceKey.includes("data")) {
      return {
        code: "recipient_not_eligible",
        statusCode: 409,
        message: `This number is not eligible for the selected data plan. Please try another data plan.${refundSuffix}`,
      };
    }

    return {
      code: "recipient_not_eligible",
      statusCode: 409,
      message: `This number is not eligible for the selected plan. Please try another plan.${refundSuffix}`,
    };
  }

  if (matchesAny(text, PLAN_UNAVAILABLE_PATTERNS)) {
    if (serviceKey.includes("data")) {
      return {
        code: "plan_unavailable",
        statusCode: 409,
        message: `This data plan isn't available at the moment. Please try another plan.${refundSuffix}`,
      };
    }

    if (serviceKey.includes("cable")) {
      return {
        code: "package_unavailable",
        statusCode: 409,
        message: `This cable TV package isn't available at the moment. Please try another package.${refundSuffix}`,
      };
    }

    return {
      code: "plan_unavailable",
      statusCode: 409,
      message: `The selected plan is not available right now. Please try another plan.${refundSuffix}`,
    };
  }

  if (matchesAny(text, DUPLICATE_REFERENCE_PATTERNS)) {
    return {
      code: "duplicate_provider_reference",
      statusCode: 409,
      message: `${service} could not be completed because the provider rejected the transaction reference. Please try again.${refundSuffix}`,
    };
  }

  if (isProviderFundsError(error)) {
    return {
      code: "provider_insufficient_funds",
      statusCode: 503,
      message: `${service} is temporarily unavailable. Please try again later.${refundSuffix}`,
    };
  }

  if (matchesAny(text, TEMPORARY_PROVIDER_PATTERNS)) {
    return {
      code: "provider_temporarily_unavailable",
      statusCode: 503,
      message: `${service} is temporarily unavailable. Please try again later.${refundSuffix}`,
    };
  }

  return {
    code: "provider_request_failed",
    statusCode: error?.statusCode || 502,
    message: `${service} could not be completed right now. Please try again later. Your wallet has been refunded.`,
  };
};
