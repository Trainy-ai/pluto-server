// Synthetic console log entries for dashboard file widget integration.
// Console logs (sys.stdout / sys.stderr) live in ClickHouse mlop_logs,
// not in PostgreSQL RunLogs, so we inject them as virtual entries.

export const CONSOLE_STDOUT = "sys.stdout";
export const CONSOLE_STDERR = "sys.stderr";

export type ConsoleLogType = "CONSOLE_STDOUT" | "CONSOLE_STDERR";

export const SYNTHETIC_CONSOLE_ENTRIES: { logName: string; logType: ConsoleLogType }[] = [
  { logName: CONSOLE_STDOUT, logType: "CONSOLE_STDOUT" },
  { logName: CONSOLE_STDERR, logType: "CONSOLE_STDERR" },
];

export function isConsoleLogType(logType: string): logType is ConsoleLogType {
  return logType === "CONSOLE_STDOUT" || logType === "CONSOLE_STDERR";
}

/** Map synthetic log type to ClickHouse logType filter value (uppercase to match stored data). */
export function consoleLogTypeToClickHouseFilter(logType: ConsoleLogType): string {
  return logType === "CONSOLE_STDOUT" ? "INFO" : "ERROR";
}
