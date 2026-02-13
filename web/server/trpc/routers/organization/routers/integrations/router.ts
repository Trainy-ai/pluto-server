import { router } from "../../../../../lib/trpc";
import { getLinearIntegrationProcedure } from "./procs/get-linear-integration";
import { getLinearOAuthUrlProcedure } from "./procs/get-linear-oauth-url";
import { removeLinearIntegrationProcedure } from "./procs/remove-linear-integration";
import { searchLinearIssuesProcedure } from "./procs/search-linear-issues";
import { syncRunsToLinearIssueProcedure } from "./procs/sync-runs-to-linear-issue";

export const integrationsRouter = router({
  getLinearIntegration: getLinearIntegrationProcedure,
  getLinearOAuthUrl: getLinearOAuthUrlProcedure,
  removeLinearIntegration: removeLinearIntegrationProcedure,
  searchLinearIssues: searchLinearIssuesProcedure,
  syncRunsToLinearIssue: syncRunsToLinearIssueProcedure,
});
