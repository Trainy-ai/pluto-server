import { router } from "../../../lib/trpc";
import { listViewsProcedure } from "./procs/list-views";
import { getViewProcedure } from "./procs/get-view";
import { createViewProcedure } from "./procs/create-view";
import { updateViewProcedure } from "./procs/update-view";
import { deleteViewProcedure } from "./procs/delete-view";

export const runTableViewsRouter = router({
  list: listViewsProcedure,
  get: getViewProcedure,
  create: createViewProcedure,
  update: updateViewProcedure,
  delete: deleteViewProcedure,
});
