import { router } from "../../../../../lib/trpc";
import { notificationCountProcedure } from "./procs/notification-count";
import { listNotificationsProcedure } from "./procs/list-notifications";
import { readNotificationsProcedure } from "./procs/read-notifications";

export const notificationsRouter = router({
  count: notificationCountProcedure,
  list: listNotificationsProcedure,
  read: readNotificationsProcedure,
});
