import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const MOCK_10 = [
  { id: 1001, title: "Topic 01", url: "https://www.v2ex.com/t/1001" },
  { id: 1002, title: "Topic 02", url: "https://www.v2ex.com/t/1002" },
  { id: 1003, title: "Topic 03", url: "https://www.v2ex.com/t/1003" },
  { id: 1004, title: "Topic 04", url: "https://www.v2ex.com/t/1004" },
  { id: 1005, title: "Topic 05", url: "https://www.v2ex.com/t/1005" },
  { id: 1006, title: "Topic 06", url: "https://www.v2ex.com/t/1006" },
  { id: 1007, title: "Topic 07", url: "https://www.v2ex.com/t/1007" },
  { id: 1008, title: "Topic 08", url: "https://www.v2ex.com/t/1008" },
  { id: 1009, title: "Topic 09", url: "https://www.v2ex.com/t/1009" },
  { id: 1010, title: "Topic 10", url: "https://www.v2ex.com/t/1010" }
];
const OLD = Buffer.from('OLD\n');
const OLD_HASH = '144b85c70a192b8c9e428e83cf57eae38bb98495b59a7c6e2108fd0f18b908a1';
const OUTPUT_HASH = 'f341897b6a3c9205e0b25acc2db88ead5df6a1760970085aead8275f3272708b';
const SCRIPT = fileURLToPath(new URL('./v2ex-hot.mjs', import.meta.url));
const PRELOAD = `const fs = require('node:fs');
globalThis.fetch = async (url, options) => {
  fs.appendFileSync(process.env.V2EX_TEST_CALLS, 'call\\n');
  if (url !== 'https://www.v2ex.com/api/topics/hot.json' || options.method !== 'GET' || !options.signal) throw Error('bad request');
  if (process.env.V2EX_TEST_MODE === 'timeout') throw Object.assign(Error('timeout'), { name: 'TimeoutError' });
  if (process.env.V2EX_TEST_MODE === 'abort-timeout') return new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => reject(Error('timeout signal did not fire')), 6000);
    options.signal.addEventListener('abort', () => {
      fs.writeFileSync(process.env.V2EX_TEST_ABORT_MARKER, 'aborted');
      clearTimeout(keepAlive);
      reject(options.signal.reason);
    }, { once: true });
  });
  const status = Number(process.env.V2EX_TEST_STATUS || 200);
  return { ok: status >= 200 && status < 300, status,
    json: async () => process.env.V2EX_TEST_MODE === 'bad-json' ? Promise.reject(SyntaxError()) : JSON.parse(Buffer.from(process.env.V2EX_TEST_BODY, 'base64').toString()) };
};`;

async function runCli({ topics = MOCK_10, mode = 'success', status = 200, old, outputDirectory = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'v2ex-hot-'));
  const outputPath = path.join(directory, 'v2ex-hot.json');
  const callsPath = path.join(directory, 'calls.txt');
  const abortMarkerPath = path.join(directory, 'abort.marker');
  const preloadPath = path.join(directory, 'test-preload.cjs');
  if (old !== undefined) await writeFile(outputPath, old);
  if (outputDirectory) {
    await mkdir(outputPath);
    await writeFile(path.join(outputPath, 'keep.txt'), 'keep');
  }
  await writeFile(preloadPath, PRELOAD);
  const child = spawn(process.execPath, ['--require', preloadPath, SCRIPT], {
    cwd: directory,
    env: { ...process.env, V2EX_TEST_BODY: Buffer.from(JSON.stringify(topics)).toString('base64'),
      V2EX_TEST_ABORT_MARKER: abortMarkerPath, V2EX_TEST_CALLS: callsPath,
      V2EX_TEST_MODE: mode, V2EX_TEST_STATUS: String(status) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { directory, outputPath, callsPath, abortMarkerPath, exitCode, stderr };
}

async function sha(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }
async function tempFiles(dir) { return (await readdir(dir)).filter(name => name.startsWith('v2ex-hot.json.tmp-')); }
async function clean(result) { await rm(result.directory, { recursive: true, force: true }); }

test('成功（C1/C3）：Given 固定 MOCK_10 HTTP 200，When 执行脚本，Then exitCode 为 0 且输出满足精确字节契约。', async () => {
  const result = await runCli();
  try {
    const bytes = await readFile(result.outputPath);
    const topics = JSON.parse(bytes.toString('utf8'));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(topics.length, 10);
    assert.ok(topics.every(topic => JSON.stringify(Object.keys(topic)) === '["id","title","url"]'));
    assert.deepEqual(topics[0], { id: 1001, title: 'Topic 01', url: 'https://www.v2ex.com/t/1001' });
    assert.equal(topics[9].id, 1010);
    assert.equal(bytes.length, 913);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), OUTPUT_HASH);
    assert.equal(result.stderr, '');
  } finally { await clean(result); }
});

test('超时（C1/C2/C3）：Given OLD\\n 和 TimeoutError mock，When 执行脚本，Then exitCode 为 1、固定错误、旧文件不变且只请求一次。', async () => {
  const result = await runCli({ mode: 'timeout', old: OLD });
  try {
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'V2EX_FETCH_FAILED\n');
    assert.equal((await stat(result.outputPath)).size, 4);
    assert.equal(await sha(result.outputPath), OLD_HASH);
    assert.deepEqual(await tempFiles(result.directory), []);
    assert.equal((await readFile(result.callsPath, 'utf8')).trim().split('\n').length, 1);
  } finally { await clean(result); }
});

test('超时信号（C1）：Given fetch pending 且预存 OLD\\n，When 5000 ms 信号触发，Then exitCode 为 1 且旧文件不变。', async () => {
  const result = await runCli({ mode: 'abort-timeout', old: OLD });
  try {
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'V2EX_FETCH_FAILED\n');
    assert.equal(await sha(result.outputPath), OLD_HASH);
    assert.equal(await readFile(result.abortMarkerPath, 'utf8'), 'aborted');
    assert.equal((await readFile(result.callsPath, 'utf8')).trim().split('\n').length, 1);
  } finally { await clean(result); }
});

test('畸形数据（C1/C2/C3）：Given MOCK_10 第 6 项缺少 url 和 OLD\\n，When 执行脚本，Then exitCode 为 1、固定错误且旧文件不变。', async () => {
  const topics = MOCK_10.map(topic => ({ ...topic }));
  delete topics[5].url;
  const result = await runCli({ topics, old: OLD });
  try {
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'V2EX_INVALID_DATA\n');
    assert.equal((await stat(result.outputPath)).size, 4);
    assert.equal(await sha(result.outputPath), OLD_HASH);
    assert.deepEqual(await tempFiles(result.directory), []);
  } finally { await clean(result); }
});

test('多余数据：Given 25 条 mock，When 执行脚本，Then 输出恰好是前 10 条。', async () => {
  const topics = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: `Topic ${i + 1}`, url: `https://example.com/${i + 1}` }));
  const result = await runCli({ topics });
  try {
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(result.outputPath, 'utf8')).map(topic => topic.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  } finally { await clean(result); }
});

test('非 2xx（C1/C3）：Given HTTP 429，When 执行脚本，Then 失败、不重试且不覆盖旧文件。', async () => {
  const result = await runCli({ status: 429, old: OLD });
  try {
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'V2EX_FETCH_FAILED\n');
    assert.equal(await sha(result.outputPath), OLD_HASH);
    assert.equal((await readFile(result.callsPath, 'utf8')).trim().split('\n').length, 1);
  } finally { await clean(result); }
});

test('写盘失败（C2/C3）：Given 正式路径为目录，When rename 失败，Then 固定返回错误并清理临时文件。', async () => {
  const result = await runCli({ outputDirectory: true });
  try {
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'V2EX_WRITE_FAILED\n');
    assert.equal(await readFile(path.join(result.outputPath, 'keep.txt'), 'utf8'), 'keep');
    assert.deepEqual(await tempFiles(result.directory), []);
  } finally { await clean(result); }
});

test('无密钥（C4）：Given 扫描功能文件，When 查找凭据，Then 无 Authorization、process.env 读取且 stderr 不含凭据。', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  const result = await runCli();
  try {
    assert.equal((source.match(/Authorization/gi) ?? []).length, 0);
    assert.equal((source.match(/process\.env/g) ?? []).length, 0);
    assert.equal(result.stderr, '');
  } finally { await clean(result); }
});

test('无效 JSON（C1/C3）：Given json() 解析失败，When 执行脚本，Then stderr 为 V2EX_INVALID_DATA 且旧文件不变。', async () => {
  const result = await runCli({ mode: 'bad-json', old: OLD });
  try {
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'V2EX_INVALID_DATA\n');
    assert.equal(await sha(result.outputPath), OLD_HASH);
  } finally { await clean(result); }
});
