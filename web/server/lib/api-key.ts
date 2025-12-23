import { nanoid } from "nanoid";

export const SECURE_API_KEY_PREFIX = "mlps_";
export const INSECURE_API_KEY_PREFIX = "mlpi_";

export const generateApiKey = (secure: boolean) => {
  return `${secure ? SECURE_API_KEY_PREFIX : INSECURE_API_KEY_PREFIX}${nanoid(
    secure ? 24 : 16
  )}`;
};

export const apiKeyToStore = async (apiKey: string) => {
  if (apiKey.startsWith(SECURE_API_KEY_PREFIX)) {
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(apiKey)
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  return apiKey;
};

export const keyToSearchFor = async (userInputApiKey: string) => {
  if (userInputApiKey.startsWith(SECURE_API_KEY_PREFIX)) {
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(userInputApiKey)
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  if (userInputApiKey.startsWith(INSECURE_API_KEY_PREFIX)) {
    return userInputApiKey;
  }

  throw new Error("Invalid API key");
};

export const createKeyString = (apiKey: string) => {
  // if the api key is secure, then keep the start mlps_x*****xx first and last 2 characters
  if (apiKey.startsWith(SECURE_API_KEY_PREFIX)) {
    const numStars = apiKey.length - 5 - 2;
    const stars = "*".repeat(numStars);
    return apiKey.slice(0, 6) + stars + apiKey.slice(-2);
  }

  return apiKey;
};
