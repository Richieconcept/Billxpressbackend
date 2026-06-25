import { getMapleradInstitutions } from "./maplerad.service.js";

const CACHE_TTL_MS = Number(process.env.TRANSFER_BANK_CACHE_TTL_MS || 3600000);

let cachedBankList = null;
let cachedAt = 0;

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
