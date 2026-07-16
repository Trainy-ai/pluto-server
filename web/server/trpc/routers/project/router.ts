import { router } from "../../../lib/trpc";
import { projectCountProcedure } from "./procs/project-count";
import { listProjectsProcedure } from "./procs/list-projects";
import { deleteProjectProcedure } from "./procs/delete-project";

export const projectsRouter = router({
  count: projectCountProcedure,
  list: listProjectsProcedure,
  delete: deleteProjectProcedure,
});
