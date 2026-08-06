import { router } from "../../../lib/trpc";
import { listSweepsProcedure } from "./procs/list-sweeps";
import { getSweepProcedure } from "./procs/get-sweep";

export const sweepsRouter = router({
  list: listSweepsProcedure,
  get: getSweepProcedure,
});
