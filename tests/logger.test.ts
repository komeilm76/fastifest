import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import type { LogLevel } from "../src/types.js";

describe("createLogger", () => {
  it("emits only messages at or above the configured threshold", () => {
    const messages: Array<[LogLevel, string]> = [];
    const logger = createLogger("warn", (level, message) =>
      messages.push([level, message]),
    );
    logger.debug("detail");
    logger.info("progress");
    logger.warn("careful");
    logger.error("failed");
    expect(messages).toEqual([
      ["warn", "careful"],
      ["error", "failed"],
    ]);
  });

  it("emits every supported message at debug level", () => {
    const messages: LogLevel[] = [];
    const logger = createLogger("debug", (level) => messages.push(level));
    logger.error("error");
    logger.warn("warning");
    logger.info("information");
    logger.debug("diagnostics");
    expect(messages).toEqual(["error", "warn", "info", "debug"]);
  });
});
