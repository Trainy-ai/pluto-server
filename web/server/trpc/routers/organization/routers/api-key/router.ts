import { router } from "../../../../../lib/trpc";
import { listApiKeysProcedure } from "./procs/list-api-keys";
import { createApiKeyProcedure } from "./procs/create-api-key";
import { deleteApiKeyProcedure } from "./procs/delete-api-key";

export const apiKeyRouter = router({
  listApiKeys: listApiKeysProcedure,
  createApiKey: createApiKeyProcedure,
  deleteApiKey: deleteApiKeyProcedure,
});
