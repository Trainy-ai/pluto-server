import { router } from "../../../../../lib/trpc";
import { createTrigger } from "./procs/create-trigger";
import { getTrigger } from "./procs/get-trigger";

export const triggerRouter = router({
  createTrigger,
  getTrigger,
});
