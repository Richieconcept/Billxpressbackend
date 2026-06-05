import ujaydataProvider from "./ujaydata.provider.js";

const providers = {
  ujaydata: ujaydataProvider,
};

export const getAirtimeProvider = (providerName) => {
  const provider = providers[providerName];

  if (!provider) {
    const error = new Error("Active airtime provider is not supported");
    error.statusCode = 503;
    throw error;
  }

  return provider;
};

export const listAirtimeProviders = () =>
  Object.keys(providers).map((name) => ({
    name,
    available: true,
  }));
