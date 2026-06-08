import { vheeboostProvider } from "./vheeboost.provider.js";

const providers = {
  vheeboost: vheeboostProvider,
};

export const getSocialGrowthProvider = (providerName) => {
  const provider = providers[providerName];

  if (!provider) {
    const error = new Error("Social growth provider is not supported");
    error.statusCode = 400;
    throw error;
  }

  return provider;
};

export const listSocialGrowthProviders = () =>
  Object.keys(providers).map((name) => ({
    name,
    available: true,
  }));
