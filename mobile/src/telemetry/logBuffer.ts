/**
 * In-memory ring buffer for recent log lines. Used by "Report issue" to dump logs.
 * No PII: avoid logging coordinates, full URLs, or user identifiers.
 */
const MAX_LINES = 200;

type LogLevel = "info" | "warn" | "error";

const buffer: string[] = [];
let index = 0;

function timestamp(): string {
  return new Date().toISOString();
}

function pushLine(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  const line = `${timestamp()} [${level}] ${message}${metaStr}`;
  if (buffer.length < MAX_LINES) {
    buffer.push(line);
  } else {
    buffer[index % MAX_LINES] = line;
    index++;
  }
  if (__DEV__) {
    if (level === "error") console.error(message, meta ?? "");
    else if (level === "warn") console.warn(message, meta ?? "");
    else console.log(message, meta ?? "");
  }
}

export const log = {
  info(message: string, meta?: Record<string, unknown>): void {
    pushLine("info", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    pushLine("warn", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>): void {
    pushLine("error", message, meta);
  },
};

/** Get recent log lines (newest last). Safe to call from UI. */
export function getRecentLogs(): string {
  if (buffer.length < MAX_LINES) return buffer.join("\n");
  const ordered: string[] = [];
  for (let i = 0; i < MAX_LINES; i++) {
    ordered.push(buffer[(index + i) % MAX_LINES]!);
  }
  return ordered.join("\n");
}

/** Clear the buffer (e.g. on logout). */
export function clearLogs(): void {
  buffer.length = 0;
  index = 0;
}
