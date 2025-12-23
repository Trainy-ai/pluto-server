import { router } from "../../../../../lib/trpc";
import { dataUsageProcedure } from "./procs/data-usage";

export const usageRouter = router({
  dataUsage: dataUsageProcedure,
});
