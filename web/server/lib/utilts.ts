// metric -> ""
// val/metric -> val
// val/metric/metric2 -> val/metric
// val/metric/metric2/metric3 -> val/metric/metric2
export const getLogGroupName = (logName: string) => {
  if (!logName) return undefined;
  const parts = logName.split("/");
  if (parts.length <= 1) {
    return "";
  }
  return parts.slice(0, parts.length - 1).join("/");
};
