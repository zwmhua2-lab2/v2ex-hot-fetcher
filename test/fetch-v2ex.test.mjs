// 1. **成功/数据过滤（C1-C2/C6-C8）**：Given 注入返回 HTTP 200、正文为 `MOCK_6` 的 fetch、工作目录无 `hot.json`，When 运行抓取器，Then 退出码 **0**、stdout/stderr 均为 `""`，产生 **5** 个元素，每个仅有 `["title","url"]` 两键，首项恰为 `{"title":"Topic-1","url":"https://www.v2ex.com/t/1"}`、末项恰为 `{"title":"Topic-5","url":"https://www.v2ex.com/t/5"}`，HTTP 调用次数 **1**。
// 2. **工作目录（C1-C2）**：Given 从非脚本所在目录执行脚本且该目录没有 `hot.json`，注入 HTTP 200/`MOCK_6`，When 执行，Then 仅在指定工作目录产生 **1** 个 `hot.json`、数组长度 **5**、仓库根目录不产生该文件。
// 3. **超时（C3-C4/C6-C8）**：Given 旧 `hot.json` 为 `OLD\n`，fetch 长时间挂起且支持 abort，When 运行并超过单次运行总预算 **3000ms**，Then 请求被取消、退出码 **1**、stderr 为 `FETCH_ERROR\n`、stdout 为 `""`、旧文件仍精确 **4 字节** `OLD\n`，不再发新请求。
// 4. **HTTP 404（C1-C2/C6-C8）**：Given 旧文件 `OLD\n` 且 HTTP 404，When 运行，Then 请求次数 **1**、退出码 **1**、stderr `FETCH_ERROR\n`，旧文件精确为 `OLD\n`。
// 5. **503 有界重试成功（C6-C8）**：Given 第一响应 503、第二响应 200/`MOCK_6`，When 运行，Then 请求次数 **2**、重试等待参数恰为 **200ms**、输出数组长度 **5**、退出码 **0**，第二请求不得获得新的一段 3000ms 预算。
// 6. **503 重试后仍失败（C1-C2/C6-C8）**：Given 旧文件 `OLD\n` 且两次均 HTTP 503，When 运行，Then 请求次数 **2**、退出码 **1**、stderr `FETCH_ERROR\n`、旧文件精确为 `OLD\n`。
// 7. **JSON 解析失败（C1-C2/C3-C4）**：Given 旧文件 `OLD\n` 且 HTTP 200 正文为 `"not json"`，When 运行，Then请求次数 **1**、退出码 **1**、stderr `FETCH_ERROR\n`、旧文件精确为 `OLD\n`。
// 8. **格式失败（C1-C2/C6-C8/数据契约）**：Given 旧文件 `OLD\n`，分别注入顶层 `{}`、仅 **4** 个记录的数组、前 5 项中第 3 项无 `url`、第 3 项 `title: 123` 的 HTTP 200 数据，When 分别运行，Then这 **4** 个场景均为退出码 **1**、stderr `FETCH_ERROR\n`、HTTP 调用次数 **1**、旧文件精确为 `OLD\n`。
// 9. **临时写入失败（C1-C2/C3-C4）**：Given 旧文件 `OLD\n`、HTTP 200/`MOCK_6`，模拟临时文件写入抛错，When 运行，Then `rename` 调用次数 **0**、退出码 **1**、stderr `FETCH_ERROR\n`、旧文件仍为 `OLD\n`。
// 10. **rename 失败（C1-C2/C3-C4）**：Given 旧文件 `OLD\n`、HTTP 200/`MOCK_6`，模拟 `rename` 抛错，When 运行，Then 退出码 **1**、stderr `FETCH_ERROR\n`、旧文件仍为 `OLD\n`，对本次临时文件进行清理尝试 **1** 次。
// 11. **内置测试器（数据契约/验收原则）**：Given Node.js 20+，When 执行 `node --test`，Then 退出码 **0**，新测试只用 mock 不发送真实公网请求。
// 12. **红牌/兼容/密钥（C3-C5）**：Given PR Files changed，When Human 核对，Then 路径集合恰好为 `{"fetch-v2ex.mjs","test/fetch-v2ex.test.mjs"}`，其他文件变更 **0**，新增第三方依赖 **0**，硬编码凭证 **0**，现有提取器与配置解析器行为保持原样。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { run } from '../fetch-v2ex.mjs';

const MOCK_6 = Array.from({length:6}, (_,i)=>({id:i+1,title:`Topic-${i+1}`,url:`https://www.v2ex.com/t/${i+1}`}));
const expected = MOCK_6.slice(0, 5).map(({title, url}) => ({title, url}));
const script = fileURLToPath(new URL('../fetch-v2ex.mjs', import.meta.url));
const reply = (status = 200, data = MOCK_6) => new Response(JSON.stringify(data), {status});
function fixture(t, old = true) {
  const cwd = fs.mkdtempSync(join(tmpdir(), 'v2ex-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(cwd)), resolve(tmpdir()));
    assert.match(cwd, /v2ex-test-[^\\/]+$/);
    fs.rmSync(cwd, {recursive: true, force: true});
  });
  if (old) fs.writeFileSync(join(cwd, 'hot.json'), 'OLD\n');
  return cwd;
}
function success(result, cwd) {
  assert.deepEqual(result, {exitCode: 0, stdout: '', stderr: ''});
  assert.equal(fs.readFileSync(join(cwd, 'hot.json'), 'utf8'), JSON.stringify(expected, null, 2) + '\n');
  assert.deepEqual(fs.readdirSync(cwd), ['hot.json']);
}
function failure(result, cwd) {
  assert.deepEqual(result, {exitCode: 1, stdout: '', stderr: 'FETCH_ERROR\n'});
  assert.deepEqual(fs.readFileSync(join(cwd, 'hot.json')), Buffer.from('OLD\n'));
}
function network(responses, calls) {
  return async (url, options) => {
    assert.equal(url, 'https://www.v2ex.com/api/topics/hot.json');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    calls.push(options.signal);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.ok(response, 'unexpected extra request');
    return response;
  };
}
test('GWT 1: 成功、过滤、顺序及独占临时写入后提交', async t => {
  const cwd = fixture(t, false), calls = [], events = [];
  const io = {...fs, openSync(path, flag) {
    assert.equal(dirname(path), cwd); assert.match(path, /hot\.json\.tmp-/); assert.equal(flag, 'wx');
    events.push('open'); return fs.openSync(path, flag);
  }, renameSync(from, to) {
    events.push('rename'); assert.equal(to, join(cwd, 'hot.json'));
    assert.equal(fs.readFileSync(from, 'utf8'), JSON.stringify(expected, null, 2) + '\n'); fs.renameSync(from, to);
  }};
  success(await run({cwd, fs: io, fetch: network([reply()], calls)}), cwd);
  assert.equal(calls.length, 1); assert.deepEqual(events, ['open', 'rename']);
});
test('GWT 2/11: 真实 CLI 在外部 cwd 成功和失败，网络完全 mock', t => {
  const rootOutput = join(dirname(script), 'hot.json');
  assert.equal(fs.existsSync(rootOutput), false);
  for (const status of [200, 404]) {
    const cwd = fixture(t, status !== 200);
    const preload = 'data:text/javascript,' + encodeURIComponent(`globalThis.fetch = async (url, o) => { if(url !== 'https://www.v2ex.com/api/topics/hot.json' || o.method !== 'GET' || o.redirect !== 'error') throw Error(); return new Response(${JSON.stringify(JSON.stringify(MOCK_6))}, {status:${status}}); };`);
    const child = spawnSync(process.execPath, ['--import', preload, script], {cwd, encoding: 'utf8', timeout: 6000});
    assert.equal(child.error, undefined);
    const result = {exitCode: child.status, stdout: child.stdout, stderr: child.stderr};
    if (status === 200) success(result, cwd); else failure(result, cwd);
  }
  assert.equal(fs.existsSync(rootOutput), false);
});
test('GWT 3: 总预算超时取消挂起 fetch，禁止重试', async t => {
  const cwd = fixture(t); let calls = 0, signal;
  const fetch = (_, o) => { calls++; signal = o.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true})); };
  const start = performance.now();
  failure(await run({cwd, fetch}), cwd);
  assert.ok(performance.now() - start >= 2900); assert.ok(signal.aborted); assert.equal(calls, 1);
});
test('GWT 4/6/7/8: 404、两次 503、JSON 和四种格式错误保留旧文件', async t => {
  const missing = structuredClone(MOCK_6); delete missing[2].url;
  const badTitle = structuredClone(MOCK_6); badTitle[2].title = 123;
  const cases = [[reply(404)], [reply(503), reply(503)], [new Response('not json')], ...[{}, MOCK_6.slice(0, 4), missing, badTitle].map(data => [reply(200, data)])];
  for (const responses of cases) {
    const cwd = fixture(t), calls = [], count = responses.length;
    failure(await run({cwd, fetch: network(responses, calls), wait: async ms => assert.equal(ms, 200)}), cwd);
    assert.equal(calls.length, count); assert.deepEqual(fs.readdirSync(cwd), ['hot.json']);
  }
});
test('GWT 5: 503 后等待 200ms，共享截止时间和取消信号', async t => {
  const cwd = fixture(t, false), calls = [], waits = []; let clock = 0;
  success(await run({cwd, now: () => clock, fetch: network([reply(503), reply()], calls), wait: async ms => { waits.push(ms); clock += ms; }}), cwd);
  assert.deepEqual(waits, [200]); assert.equal(calls.length, 2); assert.equal(calls[0], calls[1]);
  const old = fixture(t); clock = 0; let count = 0;
  failure(await run({cwd: old, now: () => clock, fetch: async () => { count++; clock += 2801; return reply(503); }, wait: async ms => { clock += ms; }}), old);
  assert.equal(count, 1);
});
test('GWT 9/10: 写入、rename 故障清理本次临时文件', async t => {
  for (const stage of ['writeFileSync', 'renameSync']) {
    const cwd = fixture(t); let renames = 0, cleanups = 0;
    const io = {...fs, renameSync(...args) { renames++; return fs.renameSync(...args); }, unlinkSync(path) { cleanups++; fs.unlinkSync(path); }};
    io[stage] = (...args) => { if (stage === 'renameSync') renames++; else fs.writeFileSync(args[0], 'partial'); throw Error('private failure detail'); };
    failure(await run({cwd, fs: io, fetch: async () => reply()}), cwd);
    assert.equal(renames, stage === 'writeFileSync' ? 0 : 1); assert.equal(cleanups, 1);
    assert.deepEqual(fs.readdirSync(cwd), ['hot.json']);
  }
});
test('补充: 临时网络错误才重试；429、重定向、永久网络错误不重试', async t => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'CERT_HAS_EXPIRED']) {
    const retry = code !== 'CERT_HAS_EXPIRED', cwd = fixture(t), calls = [];
    const error = new TypeError('fetch failed', {cause: Object.assign(new Error(), {code})});
    const result = await run({cwd, fetch: network([error, reply()], calls), wait: async ms => assert.equal(ms, 200)});
    if (retry) success(result, cwd); else failure(result, cwd);
    assert.equal(calls.length, retry ? 2 : 1);
  }
  for (const status of [301, 302, 429, 500]) {
    const cwd = fixture(t), calls = [];
    failure(await run({cwd, fetch: network([reply(status)], calls)}), cwd); assert.equal(calls.length, 1);
  }
});
test('补充: 正文读取也受同一截止时间约束，读取失败不提交', async t => {
  for (const mode of ['late', 'error', 'hang']) {
    const cwd = fixture(t); let clock = 0, signal;
    const fetch = async (_, o) => { signal = o.signal; return {status: 200, text: async () => {
      if (mode === 'late') { clock = 3001; return JSON.stringify(MOCK_6); }
      if (mode === 'error') throw Error('body failure');
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
    }}; };
    failure(await run({cwd, fetch, now: () => clock}), cwd);
    if (mode === 'hang') assert.ok(signal.aborted);
  }
});
test('补充: 独占创建碰撞不得删除他人文件，成功提交不再清理', async t => {
  const cwd = fixture(t); let cleanups = 0;
  failure(await run({cwd, fetch: async () => reply(), fs: {...fs, openSync() { throw Object.assign(new Error(), {code: 'EEXIST'}); }, unlinkSync() { cleanups++; }}}), cwd);
  assert.equal(cleanups, 0);
  success(await run({cwd, fetch: async () => reply(), fs: {...fs, unlinkSync() { throw Error('must not clean committed file'); }}}), cwd);
});
test('补充: 第二次响应正文不能重置预算，退避挂起会取消', async t => {
  const cwd = fixture(t); let clock = 0, calls = 0;
  failure(await run({cwd, now: () => clock, wait: async ms => { clock += ms; }, fetch: async () => {
    calls++;
    if (calls === 1) { clock = 2600; return reply(503); }
    return {status: 200, text: async () => { clock += 201; return JSON.stringify(MOCK_6); }};
  }}), cwd);
  assert.equal(calls, 2);
  const waiting = fixture(t); let signal; calls = 0;
  failure(await run({cwd: waiting, fetch: async () => { calls++; return reply(503); }, wait: (ms, s) => {
    assert.equal(ms, 200); signal = s;
    return new Promise((_, reject) => s.addEventListener('abort', () => reject(s.reason), {once: true}));
  }}), waiting);
  assert.equal(calls, 1); assert.ok(signal.aborted);
});
test('补充: 502/504 可重试，临时网络错误最多两次，清理失败仍保护旧文件', async t => {
  for (const status of [502, 504]) {
    const cwd = fixture(t), calls = [];
    success(await run({cwd, fetch: network([reply(status), reply()], calls), wait: async () => {}}), cwd);
    assert.equal(calls.length, 2);
  }
  const cwd = fixture(t), calls = [], error = Object.assign(new Error(), {code: 'ECONNRESET'});
  failure(await run({cwd, fetch: network([error, error], calls), wait: async () => {}}), cwd);
  assert.equal(calls.length, 2);
  let cleanups = 0;
  failure(await run({cwd, fetch: async () => reply(), fs: {...fs,
    renameSync() { throw Error(); }, unlinkSync() { cleanups++; throw Error(); },
  }}), cwd);
  assert.equal(cleanups, 1);
});
// GWT 11 通过运行完整 node --test 验证；GWT 12 通过真实 Git diff、依赖检查和原工具回归验证，记录在 PR。
