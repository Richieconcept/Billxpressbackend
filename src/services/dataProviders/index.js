import smeapiProvider from "./smeapi.provider.js";
import ujaydataProvider from "./ujaydata.provider.js";

const providers = {
  smeapi: smeapiProvider,
  ujaydata: ujaydataProvider,
};

export const getDataProvider = (providerName) => {
  const provider = providers[providerName];

  if (!provider) {
    const error = new Error("Active data provider is not supported");
    error.statusCode = 503;
    throw error;
  }

  return provider;
};

export const listDataProviders = () =>
  Object.keys(providers).map((name) => ({
    name,
    available: true,
  }));
