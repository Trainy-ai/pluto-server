import { router } from "../lib/trpc";
import { organizationRouter } from "./routers/organization/router";
import { runsRouter } from "./routers/runs/router";
import { projectsRouter } from "./routers/project/router";
import { enhancedAuthProcedure } from "./procs/auth";
import { onboardingRouter } from "./routers/onboarding/router";
import { feedbackProcedure } from "./procs/feedback";
import { dashboardViewsRouter } from "./routers/dashboard-views/router";

export const appRouter = router({
  // Procedures
  auth: enhancedAuthProcedure,
  feedback: feedbackProcedure,

  // Routers
  organization: organizationRouter,
  runs: runsRouter,
  projects: projectsRouter,
  onboarding: onboardingRouter,
  dashboardViews: dashboardViewsRouter,
});

export type AppRouter = typeof appRouter;
