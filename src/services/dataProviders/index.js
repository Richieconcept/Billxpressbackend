import autopilotProvider from "./autopilot.provider.js";
import ogdamsProvider from "./ogdams.provider.js";
import smeapiProvider from "./smeapi.provider.js";
import smeplugProvider from "./smeplug.provider.js";
import twofastProvider from "./twofast.provider.js";
import ujaydataProvider from "./ujaydata.provider.js";

const providers = {
  "2fast": twofastProvider,
  autopilot: autopilotProvider,
  ogdams: ogdamsProvider,
  smeapi: smeapiProvider,
  smeplug: smeplugProvider,
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
