import type { LogLevel } from "./types.js";

/** A log message sink. A custom sink is useful for CLI adapters and tests. */
export type LogSink = (level: LogLevel, message: string) => void;

/** Minimal structured logger used by the Fastifest core. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function consoleSink(level: LogLevel, message: string): void {
  if (level === "error") {
    console.error(message);
  } else if (level === "warn") {
    console.warn(message);
  } else if (level === "debug") {
    console.debug(message);
  } else {
    console.info(message);
  }
}

/** Create a thresholded logger; messages below the configured level are ignored. */
export function createLogger(
  level: LogLevel = "info",
  sink: LogSink = consoleSink,
): Logger {
  const log = (messageLevel: LogLevel, message: string): void => {
    if (LEVEL_WEIGHT[messageLevel] >= LEVEL_WEIGHT[level]) {
      sink(messageLevel, message);
    }
  };

  return {
    debug: (message) => log("debug", message),
    info: (message) => log("info", message),
    warn: (message) => log("warn", message),
    error: (message) => log("error", message),
  };
}
