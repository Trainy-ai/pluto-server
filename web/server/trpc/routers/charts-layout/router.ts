import { router } from "../../../lib/trpc";
import { getLayoutProcedure } from "./procs/get-layout";
import { upsertLayoutProcedure } from "./procs/upsert-layout";

export const chartsLayoutRouter = router({
  get: getLayoutProcedure,
  upsert: upsertLayoutProcedure,
});
