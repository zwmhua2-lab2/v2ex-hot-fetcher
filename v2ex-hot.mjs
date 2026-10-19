import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOT_TOPICS_URL = 'https://www.v2ex.com/api/topics/hot.json';
const REQUEST_TIMEOUT_MS = 10_000;
const OUTPUT_FILE = 'v2ex-hot.json';

export async function runOnce({
  fetchImpl = fetch,
  outputPath = path.resolve(process.cwd(), OUTPUT_FILE),
  timeoutMs = Number(process.env.V2EX_HOT_TIMEOUT_MS ?? REQUEST_TIMEOUT_MS),
  logger = console.error,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  const tempPath = `${outputPath}.${process.pid}.tmp`;

  try {
    const response = await fetchImpl(HOT_TOPICS_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`V2EX API returned HTTP ${response.status}`);
    }

    const topics = await response.json();
    if (!Array.isArray(topics) || topics.length < 10) {
      throw new Error('V2EX API did not return at least 10 topics');
    }

    await writeFile(tempPath, `${JSON.stringify(topics.slice(0, 10), null, 2)}\n`, 'utf8');
    await rename(tempPath, outputPath);
    return 0;
  } catch (error) {
    logger(`Failed to fetch V2EX hot topics: ${error.message}`);
    return 1;
  } finally {
    clearTimeout(timeout);
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runOnce();
}
