import { randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const URL = 'https://www.v2ex.com/api/topics/hot.json';
const transient = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

async function fetchRows(fetch, wait, now) {
  const controller = new AbortController();
  const { signal } = controller;
  const deadline = now() + 3000;
  const timer = setTimeout(() => controller.abort(), 3000);
  const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
  const check = () => {
    if (now() >= deadline) controller.abort();
    signal.throwIfAborted();
  };
  const bounded = async operation => {
    check();
    const value = await Promise.race([operation(), aborted]);
    check();
    return value;
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try {
        response = await bounded(() => fetch(URL, {method: 'GET', redirect: 'error', signal}));
      } catch (error) {
        check();
        if (attempt || !transient.has(error?.cause?.code ?? error?.code)) throw error;
      }
      if (response) {
        if (response.status >= 200 && response.status < 300) {
          const data = JSON.parse(await bounded(() => response.text()));
          check();
          if (!Array.isArray(data) || data.length < 5) throw new Error();
          return data.slice(0, 5).map(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item) ||
                typeof item.title !== 'string' || typeof item.url !== 'string') throw new Error();
            return {title: item.title, url: item.url};
          });
        }
        // Release rejected response bodies within the same time budget.
        if (response.body) await bounded(() => response.body.cancel());
        if (attempt || ![502, 503, 504].includes(response.status)) throw new Error();
      }
      await bounded(() => wait(200, signal));
    }
    throw new Error();
  } finally {
    clearTimeout(timer);
  }
}

export async function run({
  cwd = process.cwd(), fetch = globalThis.fetch, fs = nodeFs,
  wait = (ms, signal) => delay(ms, undefined, {signal}), now = () => performance.now(),
} = {}) {
  let temporaryPath, descriptor;
  let owned = false;
  try {
    const rows = await fetchRows(fetch, wait, now);
    const output = JSON.stringify(rows, null, 2) + '\n';
    temporaryPath = resolve(cwd, `hot.json.tmp-${randomUUID()}`);
    descriptor = fs.openSync(temporaryPath, 'wx');
    owned = true;
    fs.writeFileSync(descriptor, output, 'utf8');
    const closing = descriptor;
    descriptor = undefined;
    fs.closeSync(closing);
    fs.renameSync(temporaryPath, resolve(cwd, 'hot.json'));
    return {exitCode: 0, stdout: '', stderr: ''};
  } catch {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Best effort. */ }
    }
    if (owned) {
      try { fs.unlinkSync(temporaryPath); } catch { /* Never mask the original failure. */ }
    }
    return {exitCode: 1, stdout: '', stderr: 'FETCH_ERROR\n'};
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await run();
  process.exitCode = result.exitCode;
  if (result.stderr) process.stderr.write(result.stderr);
}
