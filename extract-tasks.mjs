import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const invokedPath = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
const isCliInvocation = invokedPath === import.meta.url;
const defaultFs = { readFileSync, renameSync, unlinkSync, writeFileSync };

export function run({ cwd = process.cwd(), fs = defaultFs } = {}) {
  let items;
  try {
    const source = fs.readFileSync(resolve(cwd, "data.json"), "utf8");
    items = JSON.parse(source);
    if (!Array.isArray(items)) throw new Error("Input must be a JSON array");
  } catch {
    if (isCliInvocation) {
      process.stderr.write("DATA_ERROR\n");
      process.exit(1);
    }
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

  let outputPath;
  let temporaryPath;
  try {
    outputPath = resolve(cwd, "tasks.json");
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
    if (isCliInvocation) {
      process.stderr.write("OUTPUT_ERROR\n");
      process.exit(1);
    }
    return { exitCode: 1, stderr: "OUTPUT_ERROR\n" };
  }
}

if (isCliInvocation) {
  const result = run();
  process.exitCode = result.exitCode;
}
