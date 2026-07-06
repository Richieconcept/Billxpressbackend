import { getMapleradInstitutions } from "./maplerad.service.js";

const CACHE_TTL_MS = Number(process.env.TRANSFER_BANK_CACHE_TTL_MS || 3600000);

let cachedBankList = null;
let cachedAt = 0;

const POPULAR_BANK_SUGGESTION_RULES = [
  { name: "OPay", slug: "opay", aliases: ["opay", "o pay", "paycom"], nubanCode: "999992", mapleradBankCode: "760" },
  { name: "PalmPay", slug: "palmpay", aliases: ["palmpay", "palm pay"], nubanCode: "999991", mapleradBankCode: "789" },
  { name: "Moniepoint MFB", slug: "moniepoint", aliases: ["moniepoint", "monie point", "teamapt"], nubanCode: "50515", mapleradBankCode: "526" },
  { name: "Kuda", slug: "kuda", aliases: ["kuda", "kuda mfb"], nubanCode: "50211", mapleradBankCode: "420" },
  { name: "Access Bank", slug: "access", aliases: ["access", "access diamond", "diamond"], nubanCode: "044", mapleradBankCode: "262" },
  { name: "Guaranty Trust Bank", slug: "gtbank", aliases: ["gtbank", "gt bank", "gtb", "guaranty trust"], nubanCode: "058", mapleradBankCode: "280" },
  { name: "Zenith Bank", slug: "zenith", nubanCode: "057", mapleradBankCode: "279" },
  { name: "Wema Bank", slug: "wema", nubanCode: "035", mapleradBankCode: "261" },
  { name: "United Bank for Africa", slug: "uba", aliases: ["uba", "united bank for africa"], nubanCode: "033", mapleradBankCode: "260" },
  { name: "Sterling Bank", slug: "sterling", nubanCode: "232", mapleradBankCode: "833" },
  { name: "Stanbic IBTC Bank", slug: "stanbic-ibtc", aliases: ["stanbic", "stanbic ibtc", "ibtc"], nubanCode: "221", mapleradBankCode: "832" },
  { name: "First City Monument Bank", slug: "fcmb", aliases: ["fcmb", "first city monument"], nubanCode: "214", mapleradBankCode: "830" },
  { name: "Fidelity Bank", slug: "fidelity", nubanCode: "070", mapleradBankCode: "286" },
  { name: "Ecobank Nigeria", slug: "ecobank", nubanCode: "050", mapleradBankCode: "263" },
  { name: "Polaris Bank", slug: "polaris", nubanCode: "076", mapleradBankCode: "308" },
  { name: "Unity Bank", slug: "unity", nubanCode: "215", mapleradBankCode: "831" },
  { name: "Paga", slug: "paga", nubanCode: "100002", mapleradBankCode: "837" },
  { name: "Carbon", slug: "carbon", nubanCode: "565", mapleradBankCode: "782" },
  { name: "Fairmoney Microfinance Bank", slug: "fairmoney", nubanCode: "51318", mapleradBankCode: "665" },
];

const normalizeBankName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(bank|banks|banking|plc|limited|ltd|microfinance|mfb|nigeria|nig|ng|company|co|services|service|digital|finance|financial|psb|payment|payments)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const makeSlug = (value) =>
  normalizeBankName(value)
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

const getRuleSearchTerms = (rule) =>
  [...(rule.aliases || []), rule.name, rule.slug]
    .map(normalizeBankName)
    .filter(Boolean);

const scoreBankNameMatch = (rule, query) => {
  const normalizedQuery = normalizeBankName(query);

  if (!normalizedQuery) {
    return 0;
  }

  return getRuleSearchTerms(rule).reduce((bestScore, term) => {
    if (term === normalizedQuery) return Math.max(bestScore, 100);
    if (term.startsWith(normalizedQuery)) return Math.max(bestScore, 80);
    if (term.includes(normalizedQuery)) return Math.max(bestScore, 60);
    if (normalizedQuery.includes(term)) return Math.max(bestScore, 50);
    return bestScore;
  }, 0);
};

const validateTransferAccountNumber = (accountNumber) => {
  const normalizedAccountNumber = String(accountNumber || "").trim();

  if (!/^\d{10}$/.test(normalizedAccountNumber)) {
    const error = new Error("A valid 10 digit account number is required");
    error.statusCode = 400;
    throw error;
  }

  return normalizedAccountNumber;
};

const passesNubanCheck = ({ accountNumber, nubanCode }) => {
  const normalizedNubanCode = String(nubanCode || "").replace(/\D/g, "");

  if (normalizedNubanCode.length !== 3) {
    return false;
  }

  const serialNumber = accountNumber.slice(0, 9);
  const checkDigit = Number(accountNumber.slice(9));
  const weightedDigits = `${normalizedNubanCode}${serialNumber}`;
  const weights = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];
  const sum = weightedDigits
    .split("")
    .reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  const calculatedCheckDigit = (10 - (sum % 10)) % 10;

  return calculatedCheckDigit === checkDigit;
};

const buildMapleradTransferBankList = (institutions) => {
  const seen = new Set();
  const banks = [];

  institutions.forEach((institution) => {
    const bankCode = String(institution.code || "").trim();
    const slug = makeSlug(institution.name);

    if (!bankCode || !slug || seen.has(bankCode)) {
      return;
    }

    seen.add(bankCode);
    banks.push({
      name: institution.name,
      slug,
      bankCode,
      mapleradBankCode: bankCode,
      availableForTransfer: true,
      resolverProvider: "maplerad",
      transferProvider: "maplerad",
    });
  });

  return banks.sort((a, b) => a.name.localeCompare(b.name));
};

export const getTransferBanks = async () => {
  const now = Date.now();

  if (cachedBankList && now - cachedAt < CACHE_TTL_MS) {
    return {
      ...cachedBankList,
      cached: true,
    };
  }

  const mapleradResponse = await getMapleradInstitutions({
    country: "NG",
    type: "NUBAN",
    pageSize: 500,
  });
  const banks = buildMapleradTransferBankList(mapleradResponse.institutions);

  cachedBankList = {
    banks,
    meta: {
      mapleradCount: mapleradResponse.institutions.length,
      availableCount: banks.length,
      cacheTtlMs: CACHE_TTL_MS,
      resolverProvider: "maplerad",
      transferProvider: "maplerad",
    },
  };
  cachedAt = now;

  return {
    ...cachedBankList,
    cached: false,
  };
};

export const suggestTransferBanks = async ({ accountNumber, query }) => {
  const normalizedQuery = String(query || "").trim();
  const rawAccountNumber = String(accountNumber || "").trim();
  const normalizedAccountNumber =
    rawAccountNumber.length === 10
      ? validateTransferAccountNumber(rawAccountNumber)
      : null;

  if (!normalizedQuery && !normalizedAccountNumber) {
    const error = new Error(
      rawAccountNumber
        ? "A valid 10 digit account number is required"
        : "Bank name or a valid 10 digit account number is required"
    );
    error.statusCode = 400;
    throw error;
  }

  const suggestions = POPULAR_BANK_SUGGESTION_RULES.map((rule, index) => {
    const nameScore = scoreBankNameMatch(rule, normalizedQuery);
    const checksumMatch = normalizedAccountNumber
      ? passesNubanCheck({
          accountNumber: normalizedAccountNumber,
          nubanCode: rule.nubanCode,
        })
      : false;

    return { rule, index, nameScore, checksumMatch };
  })
    .filter(({ nameScore, checksumMatch }) => nameScore > 0 || checksumMatch)
    .sort(
      (a, b) =>
        b.nameScore - a.nameScore ||
        Number(b.checksumMatch) - Number(a.checksumMatch) ||
        a.index - b.index
    )
    .slice(0, 8)
    .map(({ rule, nameScore, checksumMatch }) => ({
      name: rule.name,
      slug: rule.slug,
      bankCode: rule.mapleradBankCode,
      mapleradBankCode: rule.mapleradBankCode,
      availableForTransfer: true,
      resolverProvider: "maplerad",
      transferProvider: "maplerad",
      confidence:
        nameScore === 100
          ? "exact_name"
          : nameScore > 0 && checksumMatch
            ? "name_and_checksum"
            : nameScore > 0
              ? "name_search"
              : "checksum",
    }));

  return {
    accountNumber: normalizedAccountNumber,
    query: normalizedQuery || null,
    suggestions,
    meta: {
      method:
        normalizedQuery && normalizedAccountNumber
          ? "popular_name_and_nuban_checksum"
          : normalizedQuery
            ? "popular_name"
            : "nuban_checksum",
      accountNameResolved: false,
      checkedBanks: POPULAR_BANK_SUGGESTION_RULES.length,
      popularBanksOnly: true,
    },
  };
};
