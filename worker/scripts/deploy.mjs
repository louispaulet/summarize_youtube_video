import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const workerDir = process.cwd();
const repoRoot = resolve(workerDir, "..");
const repoEnvPath = resolve(repoRoot, ".env");

const repoEnv = existsSync(repoEnvPath) ? parseEnvFile(readFileSync(repoEnvPath, "utf8")) : {};
const deployEnv = {
  ...process.env,
  ...repoEnv,
};

const apiKey = deployEnv.OPENAI_API_KEY?.trim();

if (!apiKey) {
  console.error(
    `Missing OPENAI_API_KEY. Create ${repoEnvPath} from ${resolve(repoRoot, ".env.example")} before deploying.`,
  );
  process.exit(1);
}

await runWrangler(
  ["secret", "put", "OPENAI_API_KEY", "--config", "wrangler.jsonc"],
  apiKey,
  deployEnv,
);
await runWrangler(["deploy", "--config", "wrangler.jsonc"], null, deployEnv);

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

function runWrangler(args, stdin, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("npx", ["wrangler", ...args], {
      cwd: workerDir,
      env,
      stdio: ["pipe", "inherit", "inherit"],
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`wrangler ${args.join(" ")} failed with exit code ${code}.`));
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}
