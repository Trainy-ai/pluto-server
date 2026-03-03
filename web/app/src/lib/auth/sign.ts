import { authClient } from "./client";
import { resetPostHogUser } from "@/lib/analytics/posthog";

export const signOut = async (invalidateQueries: () => void) => {
  const res = await authClient.signOut();
  if (res.error) {
    throw new Error(res.error.message);
  } else {
    resetPostHogUser();
    invalidateQueries();
  }
  return res.data;
};
