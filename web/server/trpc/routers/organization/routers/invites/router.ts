import { router } from "../../../../../lib/trpc";
import { acceptInviteProcedure } from "./procs/accept-invite";
import { createInviteProcedure } from "./procs/create-invite";
import { listSentInvitesProcedure } from "./procs/list-sent-invites";
import { myInvitesProcedure } from "./procs/my-invites";
import { rejectInviteProcedure } from "./procs/reject-invite";

export const invitesRouter = router({
  createInvite: createInviteProcedure,
  acceptInvite: acceptInviteProcedure,
  rejectInvite: rejectInviteProcedure,
  myInvites: myInvitesProcedure,
  listSentInvites: listSentInvitesProcedure,
});
