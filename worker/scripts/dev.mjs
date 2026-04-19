import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const workerDir = process.cwd();
const repoRoot = resolve(workerDir, "..");
const repoEnvPath = resolve(repoRoot, ".env");
const devVarsPath = resolve(workerDir, ".dev.vars");
const workerPort = process.env.WORKER_PORT?.trim() || "8787";

const repoEnv = existsSync(repoEnvPath)
  ? parseEnvFile(readFileSync(repoEnvPath, "utf8"))
  : {};
const devEnv = {
  ...repoEnv,
  ...process.env,
};

const apiKey = devEnv.OPENAI_API_KEY?.trim();

if (!apiKey) {
  console.error(
    `Missing OPENAI_API_KEY. Create ${repoEnvPath} from ${resolve(repoRoot, ".env.example")} before running the local Worker.`,
  );
  process.exit(1);
}

let cleanupDevVars = false;
if (!existsSync(devVarsPath)) {
  writeFileSync(devVarsPath, `OPENAI_API_KEY=${apiKey}\n`, "utf8");
  cleanupDevVars = true;
}

const child = spawn(
  "npx",
  ["wrangler", "dev", "--config", "wrangler.jsonc", "--port", workerPort, "--ip", "0.0.0.0"],
  {
    cwd: workerDir,
    env: devEnv,
    stdio: "inherit",
  },
);

const cleanup = () => {
  if (cleanupDevVars && existsSync(devVarsPath)) {
    rmSync(devVarsPath, { force: true });
  }
};

process.on("SIGINT", () => {
  child.kill("SIGINT");
});

process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});

child.on("close", (code) => {
  cleanup();
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  cleanup();
  console.error(error);
  process.exit(1);
});

function parseEnvFile(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = stripQuotes(value);
  }

  return values;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
