import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultFs = { readFileSync, renameSync, unlinkSync, writeFileSync };

export function run({ cwd = process.cwd(), fs = defaultFs } = {}) {
  let items;
  try {
    const source = fs.readFileSync(resolve(cwd, "data.json"), "utf8");
    items = JSON.parse(source);
    if (!Array.isArray(items)) return { exitCode: 1, stderr: "DATA_ERROR\n" };
  } catch {
    return { exitCode: 1, stderr: "DATA_ERROR\n" };
  }

  const tasks = items
    .filter(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        item.type === "task" &&
        Object.hasOwn(item, "id") &&
        Object.hasOwn(item, "title"),
    )
    .map(({ id, title }) => ({ id, title }));

  const outputPath = resolve(cwd, "tasks.json");
  let temporaryPath;
  try {
    temporaryPath = resolve(cwd, `tasks.json.tmp-${randomUUID()}`);
    fs.writeFileSync(temporaryPath, `${JSON.stringify(tasks, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporaryPath, outputPath);
    return { exitCode: 0, stderr: "" };
  } catch {
    if (temporaryPath) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Cleanup is best effort; the original tasks.json remains untouched.
      }
    }
    return { exitCode: 1, stderr: "OUTPUT_ERROR\n" };
  }
}

const invokedPath = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  const result = run();
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
