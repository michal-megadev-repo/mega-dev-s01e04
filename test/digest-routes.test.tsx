import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-27';
const config = (runsDir: string) => ({
  adapter: 'shim' as const,
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

const temporaryDirs: string[] = [];

async function makeRunsDir() {
  const root = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  const runsDir = join(root, 'runs');
  await mkdir(runsDir);
  temporaryDirs.push(root);
  return runsDir;
}

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function event(
  job: string,
  at: string,
  status: 'ok' | 'retry' | 'fail',
  owner: string | null,
  error?: string,
) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

function tableRows(html: string) {
  const table = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0];
  if (!table) throw new Error('digest page did not render a table');
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1).map((match) => match[1]);
}

describe('digest routes', () => {
  it('renders the same sorted job data as the JSON API, retaining null owners and original offsets', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(
      join(runsDir, `${night}.jsonl`),
      [
        event('zeta-job', '2026-10-27T01:00:00-04:00', 'fail', 'old-owner', 'temporary failure'),
        event('alpha-job', '2026-10-27T02:00:00+03:00', 'retry', null),
        event('zeta-job', '2026-10-27T03:00:00+05:30', 'ok', null),
        event('threshold-job', '2026-10-27T04:00:00Z', 'retry', 'ops'),
        event('threshold-job', '2026-10-27T05:00:00Z', 'retry', 'ops'),
        event('threshold-job', '2026-10-27T06:00:00Z', 'retry', 'ops'),
      ].join('\n') + '\n',
    );

    const app = createApp(config(runsDir));
    const [pageResponse, apiResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await pageResponse.text();
    const digest = await apiResponse.json();

    expect(pageResponse.status).toBe(200);
    expect(apiResponse.status).toBe(200);
    expect(digest).toMatchObject({
      night,
      badLines: 0,
      counts: { ok: 1, retry: 4, fail: 1 },
      rows: [
        {
          job: 'alpha-job', owner: null, runs: 1, retries: 1, lastStatus: 'retry',
          firstAt: '2026-10-27T02:00:00+03:00', lastAt: '2026-10-27T02:00:00+03:00', hasFailure: false,
        },
        {
          job: 'threshold-job', owner: 'ops', runs: 3, retries: 3, lastStatus: 'retry', hasFailure: false,
        },
        {
          job: 'zeta-job', owner: null, runs: 2, retries: 0, lastStatus: 'ok',
          lastError: 'temporary failure', firstAt: '2026-10-27T01:00:00-04:00',
          lastAt: '2026-10-27T03:00:00+05:30', hasFailure: true,
        },
      ],
    });

    const rows = tableRows(html);
    expect(rows).toHaveLength(digest.rows.length);
    expect(html).toContain('alpha-job');
    expect(html).toContain('threshold-job');
    expect(html).toContain('zeta-job');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-27T01:00:00-04:00');
    expect(html).toContain('2026-10-27T03:00:00+05:30');
    expect(html.indexOf('alpha-job')).toBeLessThan(html.indexOf('threshold-job'));
    expect(html.indexOf('threshold-job')).toBeLessThan(html.indexOf('zeta-job'));
    expect(rows[1]).toMatch(/class="[^"]*warn[^"]*"|class='[^']*warn[^']*'/i);
    expect(rows[2]).toMatch(/class="[^"]*warn[^"]*"|class='[^']*warn[^']*'/i);
  });

  it('returns 404 for missing files and invalid calendar dates in both representations', async () => {
    const app = createApp(config(await makeRunsDir()));

    for (const invalidNight of ['2026-10-27', '2026-02-30']) {
      const page = await app.request(`/digest/${invalidNight}`);
      const api = await app.request(`/api/digest/${invalidNight}`);
      expect(page.status).toBe(404);
      expect(api.status).toBe(404);
      expect(await api.json()).toMatchObject({ error: expect.any(String) });
    }
  });

  it('renders an existing empty night as nothing ran and returns its empty digest', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(join(runsDir, `${night}.jsonl`), '');
    const app = createApp(config(runsDir));

    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({
      night,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps valid rows when a non-JSON line appears in the log', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(
      join(runsDir, `${night}.jsonl`),
      `${event('surviving-job', '2026-10-27T07:00:00+02:00', 'ok', 'ops')}\nnot-json\n`,
    );
    const app = createApp(config(runsDir));

    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await page.text();
    const digest = await api.json();

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(html).toContain('surviving-job');
    expect(html).toMatch(/1[^<]*(?:bad|invalid|malformed)/i);
    expect(digest).toMatchObject({ night, badLines: 1, rows: [{ job: 'surviving-job' }] });
  });
});
