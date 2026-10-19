import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(new URL('./v2ex-hot.mjs', import.meta.url));
const preloadSource = `
globalThis.fetch = async (_url, { signal }) => {
  if (process.env.V2EX_TEST_FETCH_MODE === 'timeout') {
    return new Promise((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }

  const count = Number(process.env.V2EX_TEST_TOPIC_COUNT ?? 10);
  return {
    ok: true,
    status: 200,
    json: async () => Array.from({ length: count }, (_, index) => ({ id: index + 1, title: 'topic-' + (index + 1) })),
  };
};
`;

async function runScript({
  mode = 'success',
  topicCount = 10,
  timeoutMs = 25,
  existingFileContent,
  outputIsDirectory = false,
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'v2ex-hot-'));
  const preloadPath = path.join(directory, 'test-preload.mjs');
  const outputPath = path.join(directory, 'v2ex-hot.json');
  await writeFile(preloadPath, preloadSource, 'utf8');
  if (existingFileContent !== undefined) {
    await writeFile(outputPath, existingFileContent, 'utf8');
  }
  if (outputIsDirectory) {
    await mkdir(outputPath);
    await writeFile(path.join(outputPath, 'keep.txt'), 'existing', 'utf8');
  }

  const child = spawn(process.execPath, ['--import', pathToFileURL(preloadPath).href, scriptPath], {
    cwd: directory,
    env: {
      ...process.env,
      V2EX_HOT_TIMEOUT_MS: String(timeoutMs),
      V2EX_TEST_FETCH_MODE: mode,
      V2EX_TEST_TOPIC_COUNT: String(topicCount),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  return { directory, outputPath, exitCode, stdout, stderr };
}

async function temporaryFiles(directory) {
  return (await readdir(directory)).filter(name => name.endsWith('.tmp'));
}

test('Given 成功获取10条数据，When 运行脚本，Then 生成v2ex-hot.json且退出码为0。', async () => {
  const result = await runScript({ topicCount: 10 });

  try {
    assert.equal(result.exitCode, 0, result.stderr);
    const topics = JSON.parse(await readFile(result.outputPath, 'utf8'));
    assert.equal(topics.length, 10);
    assert.deepEqual(await temporaryFiles(result.directory), []);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('Given 请求超时，When 运行脚本，Then 退出码为1且不覆盖旧文件。', async () => {
  const oldContent = '[{"id":"existing"}]';
  const result = await runScript({ mode: 'timeout', existingFileContent: oldContent });

  try {
    assert.equal(result.exitCode, 1, result.stderr);
    assert.match(result.stderr, /timed out/i);
    assert.equal(await readFile(result.outputPath, 'utf8'), oldContent);
    assert.deepEqual(await temporaryFiles(result.directory), []);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('Given 成功获取25条数据，When 运行脚本，Then 文件中恰好保存10条数据。', async () => {
  const result = await runScript({ topicCount: 25, existingFileContent: 'old output' });

  try {
    assert.equal(result.exitCode, 0, result.stderr);
    const topics = JSON.parse(await readFile(result.outputPath, 'utf8'));
    assert.equal(topics.length, 10);
    assert.deepEqual(topics.map(topic => topic.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(await temporaryFiles(result.directory), []);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('Given 正式文件路径是目录且原子替换失败，When 运行脚本，Then 退出码为1且清理临时文件。', async () => {
  const result = await runScript({ topicCount: 10, outputIsDirectory: true });

  try {
    assert.equal(result.exitCode, 1, result.stderr);
    assert.deepEqual(await temporaryFiles(result.directory), []);
    assert.equal(await readFile(path.join(result.outputPath, 'keep.txt'), 'utf8'), 'existing');
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});
