import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runOnce } from './v2ex-hot.mjs';

test('Given 成功获取10条数据，When 运行脚本，Then 生成v2ex-hot.json且退出码为0。', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'v2ex-hot-'));
  const outputPath = path.join(directory, 'v2ex-hot.json');
  const topics = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, title: `topic-${index + 1}` }));

  try {
    const exitCode = await runOnce({
      fetchImpl: async () => ({ ok: true, json: async () => topics }),
      outputPath,
      logger: () => {},
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), topics);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Given 请求超时，When 运行脚本，Then 退出码为1且不覆盖旧文件。', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'v2ex-hot-'));
  const outputPath = path.join(directory, 'v2ex-hot.json');
  const oldContent = '[{"id":"existing"}]';

  try {
    await writeFile(outputPath, oldContent, 'utf8');
    const exitCode = await runOnce({
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      outputPath,
      timeoutMs: 10,
      logger: () => {},
    });

    assert.equal(exitCode, 1);
    assert.equal(await readFile(outputPath, 'utf8'), oldContent);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
