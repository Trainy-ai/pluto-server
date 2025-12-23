import { authClient } from "./client";

export const signInEmail = async (
  options: Parameters<typeof authClient.signIn.email>[0],
  invalidateQueries: () => void,
) => {
  const res = await authClient.signIn.email(options);
  if (res.error) {
    throw new Error(res.error.message);
  } else {
    invalidateQueries();
  }
  return res.data;
};

export const signUpEmail = async (
  options: Parameters<typeof authClient.signUp.email>[0],
  invalidateQueries: () => void,
) => {
  const res = await authClient.signUp.email(options);
  if (res.error) {
    throw new Error(res.error.message);
  } else {
    invalidateQueries();
  }
  return res.data;
};

export const signInSocial = async (
  options: Parameters<typeof authClient.signIn.social>[0],
  invalidateQueries: () => void,
) => {
  const res = await authClient.signIn.social(options);
  if (res.error) {
    throw new Error(res.error.message);
  } else {
    invalidateQueries();
  }
  return res.data;
};

export const signOut = async (invalidateQueries: () => void) => {
  const res = await authClient.signOut();
  if (res.error) {
    throw new Error(res.error.message);
  } else {
    invalidateQueries();
  }
  return res.data;
};
