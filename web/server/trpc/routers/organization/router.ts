import { router } from "../../../lib/trpc";
import { invitesRouter } from "./routers/invites/router";
import { notificationsRouter } from "./routers/notifications/router";
import { apiKeyRouter } from "./routers/api-key/router";
import { usageRouter } from "./routers/usage/router";
import { listMembersProcedure } from "./procs/list-members";
import { createOrgProcedure } from "./procs/create-org";
import { deleteOrgProcedure } from "./procs/delete-org";
import { removeMemberProcedure } from "./procs/remove-member";
import { updateMemberRoleProcedure } from "./procs/update-member-role";
import { transferOwnershipProcedure } from "./procs/transfer-ownership";

export const organizationRouter = router({
  // Procedures
  createOrg: createOrgProcedure,
  deleteOrg: deleteOrgProcedure,
  removeMember: removeMemberProcedure,
  updateMemberRole: updateMemberRoleProcedure,
  transferOwnership: transferOwnershipProcedure,
  listMembers: listMembersProcedure,
  // Routers
  invite: invitesRouter,
  notifications: notificationsRouter,
  usage: usageRouter,
  apiKey: apiKeyRouter,
});
