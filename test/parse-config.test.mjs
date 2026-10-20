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

    return spawnSync(process.execPath, [scriptPath], { cwd, encoding: "utf8" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function assertResult(result, expectedOutput) {
  assert.equal(result.status, 0);
  assert.equal(result.stdout, expectedOutput);
  assert.equal(result.stderr, "");
}

test('1. Given 临时目录的 `config.json` 精确为 `{"port":8080,"url":"https://example.com/api"}`，When 以该目录为 cwd 执行脚本，Then stdout 精确等于 `Port: 8080\\nURL: https://example.com/api\\n`、stderr 为空、退出码 `0`。', () => {
  assertResult(runWithConfig('{"port":8080,"url":"https://example.com/api"}'), "Port: 8080\nURL: https://example.com/api\n");
});

test('2. Given `{"url":"https://example.com/only"}`，When 执行脚本，Then stdout 精确等于 `Port: 3000\\nURL: https://example.com/only\\n`、stderr 为空、退出码 `0`。', () => {
  assertResult(runWithConfig('{"url":"https://example.com/only"}'), "Port: 3000\nURL: https://example.com/only\n");
});

test('3. Given `{"port":8080}`，When 执行脚本，Then stdout 精确等于 `Port: 8080\\nURL: none\\n`、stderr 为空、退出码 `0`。', () => {
  assertResult(runWithConfig('{"port":8080}'), "Port: 8080\nURL: none\n");
});

test('4. Given `config.json` 不存在，When 执行脚本，Then stdout 精确等于 `Port: 3000\\nURL: none\\n`、stderr 为空、退出码 `0`。', () => {
  assertResult(runWithConfig("", { missing: true }), "Port: 3000\nURL: none\n");
});

test('5. Given `config.json` 精确为 `{"port":`（无效 JSON），When 执行脚本，Then stdout 精确等于 `Port: 3000\\nURL: none\\n`、stderr 为空、退出码 `0`。', () => {
  assertResult(runWithConfig('{"port":'), "Port: 3000\nURL: none\n");
});

test('6. Given 分别为 `{"port":"8080","url":null}`、`{"port":null,"url":123}`、`{"port":true,"url":false}`、`[]`、`null`，When 分别执行脚本，Then 每次 stdout 精确等于 `Port: 3000\\nURL: none\\n`、stderr 为空、退出码 `0`。', async (t) => {
  for (const input of ['{"port":"8080","url":null}', '{"port":null,"url":123}', '{"port":true,"url":false}', "[]", "null"]) {
    await t.test(input, () => assertResult(runWithConfig(input), "Port: 3000\nURL: none\n"));
  }
});

test('7. Given 分别为 `{"port":0,"url":""}`、`{"port":3.5,"url":"x"}`、`{"port":-1}`、`{"host":"localhost"}`，When 执行脚本，Then stdout 依次精确等于 `Port: 0\\nURL: \\n`、`Port: 3.5\\nURL: x\\n`、`Port: -1\\nURL: none\\n`、`Port: 3000\\nURL: none\\n`；四次 stderr 均为空、退出码均为 `0`。', () => {
  const inputs = [
    ['{"port":0,"url":""}', "Port: 0\nURL: \n"],
    ['{"port":3.5,"url":"x"}', "Port: 3.5\nURL: x\n"],
    ['{"port":-1}', "Port: -1\nURL: none\n"],
    ['{"host":"localhost"}', "Port: 3000\nURL: none\n"],
  ];
  for (const [input, expected] of inputs) assertResult(runWithConfig(input), expected);
});

test('8. Given 用目录替代临时 cwd 中的 `config.json` 以触发本地读取异常，When 执行脚本，Then stdout 精确等于 `Port: 3000\\nURL: none\\n`、stderr 为空、退出码 `0`。', () => {
  assertResult(runWithConfig("", { directory: true }), "Port: 3000\nURL: none\n");
});

test('8. Given 完成修改，When 静态检查脚本，Then 新增硬编码密钥数 `0`、输出原始 JSON 全文语句数 `0`、网络/子进程调用数 `0`。', () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.doesNotMatch(source, /(?:https?:\/\/|fetch\s*\(|https?\.request\s*\(|child_process|execFile|spawn\s*\()/i);
  assert.doesNotMatch(source, /console\.(?:log|error)\s*\(\s*(?:config|contents|json|source)\s*\)/i);
  assert.doesNotMatch(source, /(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"']+["']/i);
});
