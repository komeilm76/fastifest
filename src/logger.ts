import type { LogLevel } from "./types.js";

/**
 * Receives a log message emitted by a `Logger`.
 *
 * @param level - Severity of the message.
 * @param message - Human-readable log text.
 */
export type LogSink = (level: LogLevel, message: string) => void;

/**
 * Minimal structured logger used by the Fastifest API and pipeline. Logger
 * methods propagate exceptions thrown by their configured sink.
 */
export interface Logger {
  /** Emit a diagnostic message; only emitted at the `debug` threshold. */
  debug(message: string): void;
  /** Emit an informational message; emitted at `info` or more verbose levels. */
  info(message: string): void;
  /** Emit a warning; emitted at `warn` or more verbose levels. */
  warn(message: string): void;
  /** Emit an error; emitted at every threshold. */
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

/**
 * Create a thresholded logger; messages below `level` are ignored.
 *
 * @param level - Minimum message severity to emit; defaults to `info`.
 * @param sink - Receives emitted level/message pairs; defaults to the matching console method.
 * @returns A logger exposing `debug`, `info`, `warn`, and `error` methods.
 * @throws {Error} If the custom sink throws, its error propagates from the log call.
 */
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
