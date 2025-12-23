import { authClient } from "../auth/client";

export const listOrgs = async () => {
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

export const inviteMember = async (
  options: Parameters<typeof authClient.organization.inviteMember>[0],
) => {
  const res = await authClient.organization.inviteMember(options);
  if (res.error) {
    throw new Error(res.error.message);
  }
  return res.data;
};

export const acceptInvitation = async (
  options: Parameters<typeof authClient.organization.acceptInvitation>[0],
  invalidateQueries: () => void,
) => {
  const res = await authClient.organization.acceptInvitation(options);
  if (res.error) {
    throw new Error(res.error.message);
  }
  invalidateQueries();
  return res.data;
};
