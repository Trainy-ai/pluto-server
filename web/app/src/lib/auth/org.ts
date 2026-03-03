import { authClient } from "../auth/client";

const listOrgs = async () => {
  const res = await authClient.organization.list();
  if (res.error) {
    throw new Error(res.error.message);
  }
  return res.data;
};

export type Organization = Awaited<ReturnType<typeof listOrgs>>[number];

export const setActiveOrg = async (orgSlug: string) => {
  const res = await authClient.organization.setActive({
    organizationSlug: orgSlug,
  });
  if (res.error) {
    throw new Error(res.error.message);
  }
  return res.data;
};
