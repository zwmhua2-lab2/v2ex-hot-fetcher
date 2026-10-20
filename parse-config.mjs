import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let port = 3000;

try {
  const contents = readFileSync(resolve(process.cwd(), "config.json"), "utf8");
  const config = JSON.parse(contents);

  if (
    config !== null &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    typeof config.port === "number" &&
    Number.isFinite(config.port)
  ) {
    port = config.port;
  }
} catch {
  // Missing or invalid configuration uses the default port.
}

process.stdout.write(`Port: ${port}\n`);
