import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let port = 3000;
let url = "none";

try {
  const contents = readFileSync(resolve(process.cwd(), "config.json"), "utf8");
  const config = JSON.parse(contents);

  if (config !== null && typeof config === "object" && !Array.isArray(config)) {
    if (typeof config.port === "number" && Number.isFinite(config.port)) {
      port = config.port;
    }
    if (Object.hasOwn(config, "url") && typeof config.url === "string") {
      url = config.url;
    }
  }
} catch {
  // Missing or invalid configuration uses the default values.
}

process.stdout.write(`Port: ${port}\nURL: ${url}\n`);
