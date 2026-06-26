import vtpassProvider from "./vtpass.provider.js";

const providers = {
  vtpass: vtpassProvider,
};

export const getElectricityProvider = (providerName) => {
  const provider = providers[providerName];

  if (!provider) {
    const error = new Error("Electricity provider is not supported");
    error.statusCode = 400;
    throw error;
  }

  return provider;
};

export const listElectricityProviders = () =>
  Object.values(providers).map((provider) => ({
    name: provider.name,
    available: true,
  }));
