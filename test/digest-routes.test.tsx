import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow, NightDigest } from '../src/digest/types.js';

const night = '2026-10-27';
const config = (runsDir: string) => ({
  adapter: 'shim' as const,
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

const temporaryDirs: string[] = [];

async function makeRunsDir() {
  const tempRoot = resolve(tmpdir());
  const root = await mkdtemp(join(tempRoot, 'rig-digest-routes-'));
  const resolvedRoot = resolve(root);
  const relativeRoot = relative(tempRoot, resolvedRoot);
  if (
    isAbsolute(relativeRoot) ||
    !relativeRoot.startsWith('rig-digest-routes-') ||
    relativeRoot.includes(sep)
  ) {
    throw new Error('temporary runs directory escaped its expected temp root');
  }
  const runsDir = join(root, 'runs');
  await mkdir(runsDir);
  temporaryDirs.push(root);
  return runsDir;
}

afterEach(async () => {
  const tempRoot = resolve(tmpdir());
  await Promise.all(temporaryDirs.splice(0).map(async (directory) => {
    const resolvedDirectory = resolve(directory);
    const relativeDirectory = relative(tempRoot, resolvedDirectory);
    if (
      isAbsolute(relativeDirectory) ||
      !relativeDirectory.startsWith('rig-digest-routes-') ||
      relativeDirectory.includes(sep)
    ) {
      throw new Error('refusing to recursively remove a directory outside the expected temp root');
    }
    await rm(resolvedDirectory, { recursive: true, force: true });
  }));
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

function tableRows(html: string): Array<{ attributes: string; cells: string[] }> {
  const table = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0];
  if (!table) throw new Error('digest page did not render a table');
  const body = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!body) throw new Error('digest page did not render table rows in a tbody');
  return [...body.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)].map((match) => ({
    attributes: match[1],
    cells: [...match[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
      cell[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .trim(),
    ),
  }));
}

function expectedCells(row: DigestRow) {
  return [
    row.job,
    row.owner ?? '—',
    String(row.runs),
    String(row.retries),
    row.lastStatus,
    row.lastError ?? '—',
    row.firstAt,
    row.lastAt,
  ];
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
    const digest = await apiResponse.json() as NightDigest;

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
    expect(rows.map((row) => row.cells)).toEqual(digest.rows.map(expectedCells));
    expect(html).toContain('alpha-job');
    expect(html).toContain('threshold-job');
    expect(html).toContain('zeta-job');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-27T01:00:00-04:00');
    expect(html).toContain('2026-10-27T03:00:00+05:30');
    expect(html.indexOf('alpha-job')).toBeLessThan(html.indexOf('threshold-job'));
    expect(html.indexOf('threshold-job')).toBeLessThan(html.indexOf('zeta-job'));
    expect(rows[1].attributes).toMatch(/class="[^"]*warn[^"]*"|class='[^']*warn[^']*'/i);
    expect(rows[2].attributes).toMatch(/class="[^"]*warn[^"]*"|class='[^']*warn[^']*'/i);
  });

  it('returns 404 for missing files and invalid calendar dates in both representations', async () => {
    const app = createApp(config(await makeRunsDir()));

    for (const invalidNight of ['2026-10-27', '2026-02-30']) {
      const page = await app.request(`/digest/${invalidNight}`);
      const api = await app.request(`/api/digest/${invalidNight}`);
      expect(page.status).toBe(404);
      expect(api.status).toBe(404);
      const errorBody: unknown = await api.json();
      expect(errorBody).toMatchObject({ error: expect.any(String) });
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
    const digest: NightDigest = await api.json();
    expect(digest).toEqual({
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
    const digest = await api.json() as NightDigest;

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(html).toContain('surviving-job');
    expect(html).toMatch(/1[^<]*(?:bad|invalid|malformed)/i);
    expect(digest).toMatchObject({ night, badLines: 1, rows: [{ job: 'surviving-job' }] });
  });

  it('links status-board nights to digests with their raw event counts', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(
      join(runsDir, '2026-10-26.jsonl'),
      `${event('healthy', '2026-10-26T07:00:00+02:00', 'ok', 'ops')}\n`,
    );
    await writeFile(
      join(runsDir, '2026-10-27.jsonl'),
      [
        event('flaky', '2026-10-27T07:00:00+02:00', 'retry', 'ops'),
        event('flaky', '2026-10-27T07:01:00+02:00', 'fail', 'ops'),
      ].join('\n') + '\n',
    );
    const response = await createApp(config(runsDir)).request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toMatch(/<a\b[^>]*href="\/digest\/2026-10-27"[^>]*>2026-10-27<\/a>/);
    expect(html).toMatch(/<a\b[^>]*href="\/digest\/2026-10-26"[^>]*>2026-10-26<\/a>/);
    expect(html).toMatch(/2026-10-27[\s\S]*?ok\s*0[\s\S]*?retry\s*1[\s\S]*?fail\s*1/i);
    expect(html).toMatch(/2026-10-26[\s\S]*?ok\s*1[\s\S]*?retry\s*0[\s\S]*?fail\s*0/i);
  });
});
