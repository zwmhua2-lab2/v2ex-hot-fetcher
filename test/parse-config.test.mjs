import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("../parse-config.mjs", import.meta.url));

function runWithConfig(contents, { missing = false, directory = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "parse-config-"));
  try {
    if (directory) {
      mkdirSync(join(cwd, "config.json"));
    } else if (!missing) {
      writeFileSync(join(cwd, "config.json"), contents, "utf8");
    }

    const result = spawnSync(process.execPath, [scriptPath], { cwd, encoding: "utf8" });
    return { ...result, cwd };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function assertResult(result, expectedPort) {
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `Port: ${expectedPort}\n`);
  assert.equal(result.stderr, "");
}

test("Given 临时工作目录含 `config.json` 内容 `{\"port\":8080}`，When 从该目录执行 `node /绝对路径/parse-config.mjs`，Then stdout 精确等于 `Port: 8080\\n`，stderr 为空，退出码 `0`。", () => {
  assertResult(runWithConfig('{"port":8080}'), 8080);
});

test("Given `config.json` 不存在，When 执行脚本，Then stdout 精确等于 `Port: 3000\\n`，stderr 为空，退出码 `0`。", () => {
  assertResult(runWithConfig("", { missing: true }), 3000);
});

test("Given `config.json` 内容 `{\"port\":`（非法 JSON），When 执行脚本，Then stdout 精确等于 `Port: 3000\\n`，stderr 为空，退出码 `0`。", () => {
  assertResult(runWithConfig('{"port":'), 3000);
});

test("Given `config.json` 内容 `{\"host\":\"localhost\"}`，When 执行脚本，Then stdout 精确等于 `Port: 3000\\n`，stderr 为空，退出码 `0`。", () => {
  assertResult(runWithConfig('{"host":"localhost"}'), 3000);
});

test("Given 分别输入 `{\"port\":\"8080\"}`、`{\"port\":null}`、`{\"port\":true}`、`[]`、`null`，When 每次独立执行脚本，Then 每次 stdout 均精确等于 `Port: 3000\\n`、stderr 为空、退出码 `0`。", async (t) => {
  for (const input of ['{"port":"8080"}', '{"port":null}', '{"port":true}', "[]", "null"]) {
    await t.test(input, () => assertResult(runWithConfig(input), 3000));
  }
});

test("Given 分别输入 `{\"port\":0}`、`{\"port\":3.5}`，When 每次独立执行脚本，Then stdout 分别精确等于 `Port: 0\\n` 与 `Port: 3.5\\n`，stderr 为空、退出码 `0`。", () => {
  assertResult(runWithConfig('{"port":0}'), 0);
  assertResult(runWithConfig('{"port":3.5}'), 3.5);
});

test("Given 模拟本地读取异常，When 执行脚本，Then stdout 精确等于 `Port: 3000\\n`，stderr 为空，退出码 `0`。", () => {
  assertResult(runWithConfig("", { directory: true }), 3000);
});

test("Given 完成实现，When 静态检查新增脚本与测试，Then 新增硬编码密钥数量为 `0`、输出原始 JSON 全文的语句数量为 `0`，且无网络/子进程调用。", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.doesNotMatch(source, /(?:https?:\/\/|fetch\s*\(|https?\.request\s*\(|child_process|execFile|spawn\s*\()/i);
  assert.doesNotMatch(source, /console\.(?:log|error)\s*\(\s*(?:config|contents|json|source)\s*\)/i);
  assert.doesNotMatch(source, /(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"']+["']/i);
});
