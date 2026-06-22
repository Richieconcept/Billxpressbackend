import { getMapleradInstitutions } from "./maplerad.service.js";
import { getPaystackBanks } from "./paystack.service.js";

const CACHE_TTL_MS = Number(process.env.TRANSFER_BANK_CACHE_TTL_MS || 3600000);

let cachedBankList = null;
let cachedAt = 0;

const COMMON_BANK_ALIASES = {
  "access bank": ["access"],
  "access bank diamond": ["access diamond", "diamond bank"],
  "ecobank nigeria": ["ecobank"],
  "fidelity bank": ["fidelity"],
  "first bank of nigeria": ["first bank", "firstbank", "fbn"],
  "first city monument bank": ["fcmb"],
  "guaranty trust bank": ["gtbank", "guaranty trust", "gtb"],
  "keystone bank": ["keystone"],
  "polaris bank": ["polaris", "skye bank"],
  "stanbic ibtc bank": ["stanbic", "stanbic ibtc"],
  "standard chartered bank": ["standard chartered", "standard chartered nigeria"],
  "sterling bank": ["sterling"],
  "union bank of nigeria": ["union bank"],
  "united bank for africa": ["uba", "united bank africa"],
  "unity bank": ["unity"],
  "wema bank": ["wema"],
  "zenith bank": ["zenith"],
  "kuda": ["kuda bank", "kuda microfinance bank"],
  "opay": ["opay digital services limited", "opay digital services"],
  "palmpay": ["palm pay", "palmpay limited"],
  "moniepoint": ["moniepoint mfb", "moniepoint microfinance bank"],
};

const parseManualMappings = () => {
  const raw = process.env.TRANSFER_BANK_MAPPINGS_JSON;

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn("TRANSFER_BANK_MAPPINGS_JSON is not valid JSON");
    return [];
  }
};

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

const namesForMatching = (name, aliases = []) => {
  const normalizedName = normalizeBankName(name);
  const commonAliases = COMMON_BANK_ALIASES[normalizedName] || [];

  return [...new Set([name, normalizedName, ...aliases, ...commonAliases])]
    .map(normalizeBankName)
    .filter(Boolean);
};

const buildMapleradIndex = (institutions) => {
  const index = new Map();

  institutions.forEach((institution) => {
    namesForMatching(institution.name).forEach((name) => {
      if (!index.has(name)) {
        index.set(name, institution);
      }
    });
  });

  return index;
};

const findMapleradMatch = ({ paystackBank, mapleradIndex, manualMapping }) => {
  if (manualMapping?.mapleradBankCode) {
    return {
      name: manualMapping.mapleradName || manualMapping.name || paystackBank.name,
      code: String(manualMapping.mapleradBankCode),
    };
  }

  const candidateNames = namesForMatching(paystackBank.name, manualMapping?.aliases);

  for (const candidateName of candidateNames) {
    if (mapleradIndex.has(candidateName)) {
      return mapleradIndex.get(candidateName);
    }
  }

  return null;
};

const buildTransferBankList = ({ paystackBanks, mapleradBanks }) => {
  const manualMappings = parseManualMappings();
  const manualByPaystackCode = new Map(
    manualMappings
      .filter((mapping) => mapping.paystackBankCode)
      .map((mapping) => [String(mapping.paystackBankCode), mapping])
  );
  const mapleradIndex = buildMapleradIndex(mapleradBanks);
  const seen = new Set();
  const banks = [];

  paystackBanks
    .filter((bank) => bank.active)
    .forEach((paystackBank) => {
      const manualMapping = manualByPaystackCode.get(String(paystackBank.code));
      const mapleradMatch = findMapleradMatch({
        paystackBank,
        mapleradIndex,
        manualMapping,
      });
      const slug = makeSlug(manualMapping?.slug || paystackBank.slug || paystackBank.name);

      if (seen.has(slug)) {
        return;
      }

      seen.add(slug);
      banks.push({
        name: manualMapping?.name || paystackBank.name,
        slug,
        paystackBankCode: String(paystackBank.code),
        mapleradBankCode: mapleradMatch?.code ? String(mapleradMatch.code) : null,
        availableForTransfer: Boolean(mapleradMatch?.code),
        paystackName: paystackBank.name,
        mapleradName: mapleradMatch?.name || null,
      });
    });

  return banks.sort((a, b) => a.name.localeCompare(b.name));
};

export const getTransferBanks = async ({ includeUnmapped = false } = {}) => {
  const now = Date.now();

  if (cachedBankList && now - cachedAt < CACHE_TTL_MS) {
    const banks = includeUnmapped
      ? cachedBankList.banks
      : cachedBankList.banks.filter((bank) => bank.availableForTransfer);

    return {
      ...cachedBankList,
      banks,
      cached: true,
    };
  }

  const [paystackBanks, mapleradResponse] = await Promise.all([
    getPaystackBanks(),
    getMapleradInstitutions({ country: "NG", type: "NUBAN", pageSize: 500 }),
  ]);
  const banks = buildTransferBankList({
    paystackBanks,
    mapleradBanks: mapleradResponse.institutions,
  });

  cachedBankList = {
    banks,
    meta: {
      paystackCount: paystackBanks.length,
      mapleradCount: mapleradResponse.institutions.length,
      mappedCount: banks.filter((bank) => bank.availableForTransfer).length,
      unmappedCount: banks.filter((bank) => !bank.availableForTransfer).length,
      cacheTtlMs: CACHE_TTL_MS,
    },
  };
  cachedAt = now;

  return {
    ...cachedBankList,
    banks: includeUnmapped
      ? cachedBankList.banks
      : cachedBankList.banks.filter((bank) => bank.availableForTransfer),
    cached: false,
  };
};
