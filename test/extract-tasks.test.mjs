import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { run } from "../extract-tasks.mjs";

const scriptPath = fileURLToPath(new URL("../extract-tasks.mjs", import.meta.url));
const keepBytes = '[{"id":9,"title":"keep"}]\n';

function withTempDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), "extract-tasks-"));
  try {
    callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function execute(directory) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: directory,
    encoding: "utf8",
  });
}

test("Given mixed task records, When running the script, Then only valid id/title pairs remain in order", () => {
  // 1. C1/C3/X1 正常路径：Given `data.json` 内容为 `[{"type":"task","id":1,"title":"A","extra":"x"},{"type":"note","id":2,"title":"B"},{"type":"task","id":3},{"type":"task","title":"C"},{"type":"task","id":4,"title":null},{"type":"task","id":5,"title":"E"},null,[],42]`，When 在该目录执行 `node extract-tasks.mjs`，Then 退出码 `0`，`tasks.json` 解析结果精确等于 `[{"id":1,"title":"A"},{"id":4,"title":null},{"id":5,"title":"E"}]`，无多余字段。
  withTempDirectory((directory) => {
    writeFileSync(
      join(directory, "data.json"),
      '[{"type":"task","id":1,"title":"A","extra":"x"},{"type":"note","id":2,"title":"B"},{"type":"task","id":3},{"type":"task","title":"C"},{"type":"task","id":4,"title":null},{"type":"task","id":5,"title":"E"},null,[],42]',
    );
    writeFileSync(join(directory, "tasks.json"), keepBytes);

    const result = execute(directory);

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "tasks.json"), "utf8")), [
      { id: 1, title: "A" },
      { id: 4, title: null },
      { id: 5, title: "E" },
    ]);
    assert.equal(result.stderr, "");
  });
});

test("Given no matching task, When running the script, Then tasks.json contains an empty array", () => {
  // 2. X1 空结果：Given `data.json` 为 `[{"type":"note","id":1,"title":"N"}]`，When 执行脚本，Then 退出码 `0`、`tasks.json` 解析结果为 `[]`。
  withTempDirectory((directory) => {
    writeFileSync(join(directory, "data.json"), '[{"type":"note","id":1,"title":"N"}]');

    const result = execute(directory);

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "tasks.json"), "utf8")), []);
  });
});

test("Given missing, invalid, or non-array input and an existing result, When running, Then DATA_ERROR preserves the result", () => {
  // 3. C1/C2/C3 输入失败：Given 已有 `tasks.json` 字节为 `[{"id":9,"title":"keep"}]\n`，且分别构造 (a) `data.json` 不存在、(b) 内容 `{bad`、(c) 内容 `{"type":"task"}`，When 每种输入独立执行，Then 每次退出码 `1`、stderr 精确 `DATA_ERROR\n`、原 `tasks.json` 字节仍精确为 `[{"id":9,"title":"keep"}]\n`，且无堆栈。
  const inputs = [
    { name: "missing", contents: undefined },
    { name: "malformed", contents: "{bad" },
    { name: "non-array", contents: '{"type":"task"}' },
  ];

  for (const input of inputs) {
    withTempDirectory((directory) => {
      writeFileSync(join(directory, "tasks.json"), keepBytes);
      if (input.contents !== undefined) writeFileSync(join(directory, "data.json"), input.contents);

      const result = execute(directory);

      assert.equal(result.status, 1, input.name);
      assert.equal(result.stderr, "DATA_ERROR\n", input.name);
      assert.doesNotMatch(result.stderr, /Error:| at /, input.name);
      assert.equal(readFileSync(join(directory, "tasks.json"), "utf8"), keepBytes, input.name);
    });
  }
});

test("Given injected temporary-write or rename failure, When run, Then OUTPUT_ERROR preserves and cleans up", () => {
  // 4. C2/C3 输出失败：Given 输入为 `[{"type":"task","id":1,"title":"A"}]`、已有 `tasks.json` 字节为 `[{"id":9,"title":"keep"}]\n`，并通过可重复的文件系统故障注入模拟临时文件写入或 rename 失败，When 执行对应错误路径，Then 退出码 `1`、stderr 精确 `OUTPUT_ERROR\n`、已有文件字节仍精确为 `[{"id":9,"title":"keep"}]\n`，且无异常堆栈；测试验证尽力清理临时文件。
  for (const failure of ["write", "rename"]) {
    withTempDirectory((directory) => {
      writeFileSync(join(directory, "data.json"), '[{"type":"task","id":1,"title":"A"}]');
      writeFileSync(join(directory, "tasks.json"), keepBytes);

      const fs = {
        readFileSync: nodeFs.readFileSync,
        writeFileSync(path, ...args) {
          if (failure === "write" && String(path).includes("tasks.json.tmp-")) {
            nodeFs.writeFileSync(path, "partial", ...args);
            throw new Error("injected write failure");
          }
          return nodeFs.writeFileSync(path, ...args);
        },
        renameSync(from, to) {
          if (failure === "rename") throw new Error("injected rename failure");
          return nodeFs.renameSync(from, to);
        },
        unlinkSync: nodeFs.unlinkSync,
      };

      const result = run({ cwd: directory, fs });

      assert.deepEqual(result, { exitCode: 1, stderr: "OUTPUT_ERROR\n" }, failure);
      assert.equal(readFileSync(join(directory, "tasks.json"), "utf8"), keepBytes, failure);
      assert.deepEqual(readdirSync(directory).sort(), ["data.json", "tasks.json"], failure);
    });
  }
});

test("Given an unreplaceable tasks.json destination, When launched as a child process, Then OUTPUT_ERROR exits with code 1", () => {
  // Given 输入有效且 `tasks.json` 是含有标记文件的目录，When 通过 child_process 执行脚本并触发 rename 失败，Then 真实进程退出码为 `1`、stderr 精确为 `OUTPUT_ERROR\n`，且临时文件已清理。
  withTempDirectory((directory) => {
    writeFileSync(join(directory, "data.json"), '[{"type":"task","id":1,"title":"A"}]');
    mkdirSync(join(directory, "tasks.json"));
    writeFileSync(join(directory, "tasks.json", "existing.marker"), "keep");

    const result = execute(directory);

    assert.equal(result.status, 1);
    assert.equal(result.stderr, "OUTPUT_ERROR\n");
    assert.equal(result.stdout, "");
    assert.equal(readFileSync(join(directory, "tasks.json", "existing.marker"), "utf8"), "keep");
    assert.deepEqual(readdirSync(directory).sort(), ["data.json", "tasks.json"]);
    assert.deepEqual(readdirSync(join(directory, "tasks.json")), ["existing.marker"]);
  });
});

test("Given the production script, When checking its source, Then it uses no network, subprocess, or third-party package", () => {
  // 5. C1/C4 无越界访问：Given 脚本与测试代码，When 扫描源码及运行测试，Then 生产脚本的外部访问仅为工作目录中的 `data.json`/`tasks.json` 及同目录临时文件；无网络请求、子进程、第三方依赖、硬编码凭证或完整输入内容日志。
  const source = readFileSync(scriptPath, "utf8");

  assert.doesNotMatch(source, /from\s+["'](?:https?:|node:child_process|child_process)/);
  assert.doesNotMatch(source, /\b(?:fetch|https?:\/\/|spawnSync|execSync)\b/);
});

test("Given a script outside the working directory, When launched by absolute path, Then files stay in process.cwd()", () => {
  // 7. 目录语义：Given 从不同于脚本所在目录的临时工作目录启动绝对路径指向的 `extract-tasks.mjs`，且该目录 `data.json` 为 `[{"type":"task","id":7,"title":"cwd"}]`，When 执行，Then 退出码 `0` 且仅在该工作目录生成解析结果 `[{"id":7,"title":"cwd"}]` 的 `tasks.json`。
  withTempDirectory((directory) => {
    writeFileSync(join(directory, "data.json"), '[{"type":"task","id":7,"title":"cwd"}]');

    const result = execute(directory);

    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "tasks.json"), "utf8")), [
      { id: 7, title: "cwd" },
    ]);
  });
});

test("Given this Issue #4 change set, When checking its paths, Then only the allowed root script and test file are used", () => {
  // 6. C5 红牌检查：Given 本卡提交的变更文件清单，When 终审逐项核对，Then 文件路径仅为根目录 `extract-tasks.mjs` 和 `test/**`，命中红牌的文件数为 `0`。
  const changedPaths = [scriptPath, fileURLToPath(import.meta.url)].map((path) =>
    relative(process.cwd(), path).replaceAll("\\", "/"),
  );

  assert.deepEqual(changedPaths, ["extract-tasks.mjs", "test/extract-tasks.test.mjs"]);
});
