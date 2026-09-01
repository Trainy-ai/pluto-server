import { router } from "../../../lib/trpc";
import { listViewsProcedure } from "./procs/list-views";
import { getViewProcedure } from "./procs/get-view";
import { createViewProcedure } from "./procs/create-view";
import { updateViewProcedure } from "./procs/update-view";
import { deleteViewProcedure } from "./procs/delete-view";
import { listVersionsProcedure } from "./procs/list-versions";
import { getVersionProcedure } from "./procs/get-version";
import { restoreVersionProcedure } from "./procs/restore-version";

export const dashboardViewsRouter = router({
  list: listViewsProcedure,
  get: getViewProcedure,
  create: createViewProcedure,
  update: updateViewProcedure,
  delete: deleteViewProcedure,
  listVersions: listVersionsProcedure,
  getVersion: getVersionProcedure,
  restoreVersion: restoreVersionProcedure,
});
