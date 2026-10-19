import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = 'https://www.v2ex.com/api/topics/hot.json';
const REQUEST_TIMEOUT_MS = 5000;
const OUTPUT_FILE = 'v2ex-hot.json';

function normalizeTopics(value) {
  if (!Array.isArray(value) || value.length < 10) return null;

  const normalized = [];
  for (const topic of value.slice(0, 10)) {
    if (!topic || typeof topic !== 'object' || Array.isArray(topic)) return null;
    const { id, title, url } = topic;
    if (!Number.isInteger(id) || typeof title !== 'string' || title.trim() === '') return null;
    if (typeof url !== 'string' || !(url.startsWith('http://') || url.startsWith('https://'))) return null;
    normalized.push({ id, title, url });
  }
  return normalized;
}

function fail(stderr, code) {
  stderr.write(`${code}\n`);
  return 1;
}

export async function run({
  fetchImpl = fetch,
  outputPath = path.resolve(process.cwd(), OUTPUT_FILE),
  stderr = process.stderr,
} = {}) {
  let response;
  try {
    response = await fetchImpl(API_URL, { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return fail(stderr, 'V2EX_FETCH_FAILED');
  }

  if (!response?.ok) return fail(stderr, 'V2EX_FETCH_FAILED');

  let payload;
  try {
    payload = await response.json();
  } catch {
    return fail(stderr, 'V2EX_INVALID_DATA');
  }

  const normalized = normalizeTopics(payload);
  if (!normalized) return fail(stderr, 'V2EX_INVALID_DATA');

  const tempPath = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const contents = `${JSON.stringify(normalized, null, 2)}\n`;
    await writeFile(tempPath, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(tempPath, outputPath);
    return 0;
  } catch {
    return fail(stderr, 'V2EX_WRITE_FAILED');
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run();
}
