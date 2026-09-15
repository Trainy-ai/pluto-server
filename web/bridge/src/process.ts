import { spawn } from "node:child_process";

/**
 * Spawn a CLI and yield its stdout line by line. Kills the child when the
 * abort signal fires; throws (with a stderr tail) when the process fails
 * before producing a terminal event.
 */
export async function* runProcessLines(
  command: string,
  args: string[],
  { signal, cwd, input }: { signal: AbortSignal; cwd?: string; input?: string },
): AsyncIterable<string> {
  const child = spawn(command, args, {
    cwd,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    env: process.env,
  });
  if (input !== undefined && child.stdin) {
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  }

  const onAbort = () => child.kill("SIGTERM");
  signal.addEventListener("abort", onAbort, { once: true });

  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2000);
  });

  const lines: string[] = [];
  let buffered = "";
  let done = false;
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    const parts = buffered.split("\n");
    buffered = parts.pop() ?? "";
    lines.push(...parts);
    notify();
  });
  child.on("error", (error) => {
    failure = new Error(
      `Could not start "${command}": ${error.message}. Is it installed and on PATH?`,
    );
    done = true;
    notify();
  });
  child.on("close", (code) => {
    if (buffered.trim()) lines.push(buffered);
    if (code !== 0 && !signal.aborted && !failure) {
      failure = new Error(
        `${command} exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ""}`,
      );
    }
    done = true;
    notify();
  });

  try {
    while (true) {
      while (lines.length > 0) yield lines.shift()!;
      if (done) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    if (failure) throw failure;
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!done) child.kill("SIGTERM");
  }
}
