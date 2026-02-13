import { router } from "../../../../../lib/trpc";
import { getLinearIntegrationProcedure } from "./procs/get-linear-integration";
import { saveLinearApiKeyProcedure } from "./procs/save-linear-api-key";
import { removeLinearIntegrationProcedure } from "./procs/remove-linear-integration";
import { searchLinearIssuesProcedure } from "./procs/search-linear-issues";
import { syncRunsToLinearIssueProcedure } from "./procs/sync-runs-to-linear-issue";

export const integrationsRouter = router({
  getLinearIntegration: getLinearIntegrationProcedure,
  saveLinearApiKey: saveLinearApiKeyProcedure,
  removeLinearIntegration: removeLinearIntegrationProcedure,
  searchLinearIssues: searchLinearIssuesProcedure,
  syncRunsToLinearIssue: syncRunsToLinearIssueProcedure,
});
