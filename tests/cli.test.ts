import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { createLogger } from "../src/logger.js";

let projectRoot: string;
const silentLogger = createLogger("debug", () => {});

async function makePng(): Promise<Buffer> {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#376fa5"/></svg>',
  );
  return sharp(svg).png().toBuffer();
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "fastifest-cli-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("runCli", () => {
  it("prints help and version without running generation", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    await expect(
      runCli(["--help"], {
        cwd: projectRoot,
        writeStdout: (message) => stdout.push(message),
        writeStderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(0);
    expect(stdout.join("")).toContain("Usage: fastifest [options]");
    expect(stderr).toEqual([]);
    await expect(access(join(projectRoot, "public"))).rejects.toThrow();

    stdout.length = 0;
    await expect(
      runCli(["--version"], {
        cwd: projectRoot,
        writeStdout: (message) => stdout.push(message),
        writeStderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(0);
    expect(stdout.join("").trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.each([
    [["--config"], "requires a config file path"],
    [["--config", ""], "requires a config file path"],
    [["--config", "one.ts", "--config", "two.ts"], "only be provided once"],
    [["--unknown"], "Unknown option"],
    [["unexpected"], "Unexpected positional argument"],
  ])(
    "returns a usage error for invalid arguments %j",
    async (args, message) => {
      const stderr: string[] = [];
      await expect(
        runCli(args, {
          writeStderr: (output) => stderr.push(output),
        }),
      ).resolves.toBe(2);
      expect(stderr.join("")).toContain(message);
      expect(stderr.join("")).toContain("Usage: fastifest");
    },
  );

  it("returns success after creating the starter and does not generate a manifest", async () => {
    const messages: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    await expect(
      runCli([], {
        cwd: projectRoot,
        logger: createLogger("debug", (_level, message) =>
          messages.push(message),
        ),
        writeStdout: (message) => stdout.push(message),
        writeStderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(0);

    expect(messages.join("\n")).toContain(
      "Customize it, then run Fastifest again",
    );
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([]);
    await access(join(projectRoot, "manifest.template.ts"));
    await expect(access(join(projectRoot, "public"))).rejects.toThrow();
  });

  it("uses the explicit config file and invokes the shared generation core", async () => {
    const configFile = join(projectRoot, "fastifest.config.ts");
    const templateFile = join(projectRoot, "metadata", "app.ts");
    await mkdir(join(projectRoot, "assets", "logos"), { recursive: true });
    await mkdir(join(projectRoot, "metadata"), { recursive: true });
    await writeFile(
      configFile,
      `export default { template: { path: "./metadata/app.ts" } };\n`,
    );
    await writeFile(
      templateFile,
      `export default { name: "CLI App", start_url: "/", display: "standalone" };\n`,
    );
    await writeFile(
      join(projectRoot, "assets", "logos", "brand.png"),
      await makePng(),
    );

    const stdout: string[] = [];
    const stderr: string[] = [];
    await expect(
      runCli(["--config", "fastifest.config.ts"], {
        cwd: projectRoot,
        logger: createLogger("debug", (_level, message) =>
          stdout.push(message),
        ),
        writeStdout: (message) => stdout.push(message),
        writeStderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(0);

    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Generated manifest at");
    const manifest = JSON.parse(
      await readFile(join(projectRoot, "public", "manifest.json"), "utf8"),
    ) as { name: string };
    expect(manifest.name).toBe("CLI App");
  });

  it("returns a non-zero exit code and concise diagnostics for generation errors", async () => {
    const configFile = join(projectRoot, "fastifest.config.ts");
    await writeFile(
      configFile,
      `export default { template: { enabled: false } };\n`,
    );
    const stderr: string[] = [];

    await expect(
      runCli(["--config=fastifest.config.ts"], {
        cwd: projectRoot,
        logger: silentLogger,
        writeStderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(1);
    expect(stderr.join("")).toContain("TEMPLATE_MISSING");
    expect(stderr.join("")).toContain("template.enabled to true");
    await expect(access(join(projectRoot, "public"))).rejects.toThrow();
  });
});
