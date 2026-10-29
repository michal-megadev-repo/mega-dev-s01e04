import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const directories: string[] = [];
const event = { at: '2026-10-28T23:00:02+01:00', job: 'job', status: 'ok', owner: 'rook' };

function log(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  directories.push(directory);
  writeFileSync(join(directory, `${night}.jsonl`), contents);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('readNight', () => {
  it('aggregates the read-only real night into five jobs and one bad line', () => {
    const digest = readNight('runs', night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows).toEqual([
      {
        job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00', hasFailure: false,
      },
      {
        job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
        firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00', hasFailure: false,
      },
      {
        job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
        firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00', hasFailure: false,
      },
      {
        job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00', hasFailure: true,
      },
      {
        job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00', hasFailure: false,
      },
    ]);
  });

  it('preserves file order, offsets, latest supplied error and failure after recovery', () => {
    const events = [
      { ...event, at: '2026-10-29T02:00:00.123+05:30', status: 'fail', error: 'first error' },
      { ...event, at: '2026-10-28T01:00:00-07:00', status: 'retry', owner: 'other', error: 'last error' },
      { ...event, at: '2026-10-27T00:00:00Z', owner: null },
    ];
    const digest = readNight(log(events.map(value => JSON.stringify(value)).join('\n')), night);
    expect(digest?.counts).toEqual({ ok: 1, retry: 1, fail: 1 });
    expect(digest?.rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'last error',
      firstAt: events[0].at, lastAt: events[2].at, hasFailure: true,
    }]);
  });

  it('keeps an explicitly supplied empty error and sorts jobs by code units', () => {
    const events = ['ä', 'a', 'Z', '__proto__'].map(job => ({ ...event, job, error: '' }));
    const digest = readNight(log(events.map(value => JSON.stringify(value)).join('\n')), night);
    expect(digest?.rows.map(row => row.job)).toEqual(['Z', '__proto__', 'a', 'ä']);
    expect(digest?.rows.every(row => row.lastError === '')).toBe(true);
  });

  it('counts malformed JSON and invalid fields without changing valid aggregates', () => {
    const invalid: unknown[] = [
      null, [], 1, 'text', {},
      { ...event, job: '' }, { ...event, job: '  ' }, { ...event, job: null },
      { ...event, status: 'pending' }, { ...event, owner: undefined }, { ...event, owner: 7 },
      { ...event, error: null }, { ...event, error: 7 }, { ...event, at: 7 },
    ];
    const lines = invalid.map(value => JSON.stringify(value));
    const digest = readNight(log(['', ' \t', '{broken', ...lines, JSON.stringify(event), ''].join('\r\n')), night);
    expect(digest?.badLines).toBe(invalid.length + 1);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0].runs).toBe(1);
  });

  it.each([
    '2026-02-29T01:00:00Z', '1900-02-29T01:00:00Z', '2026-04-31T01:00:00Z',
    '2026-13-01T01:00:00Z', '2026-10-00T01:00:00Z', '2026-10-28',
    '2026-10-28T01:00:00', '2026-10-28T24:00:00Z', '2026-10-28T01:60:00Z',
    '2026-10-28T01:00:60Z', '2026-10-28T01:00:00+24:00', '2026-10-28T01:00:00+01:60',
    'garbage',
  ])('counts invalid timestamp %s as a bad line', at => {
    expect(readNight(log(JSON.stringify({ ...event, at })), night)).toEqual({
      night, rows: [], badLines: 1, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['2000-02-29T01:00:00Z', '2024-02-29T01:00:00.000001-03:30'])('accepts calendar-valid timestamp %s', at => {
    expect(readNight(log(JSON.stringify({ ...event, at })), night)?.rows[0].firstAt).toBe(at);
  });

  it.each(['', '\r\n \t\n'])('returns an empty digest for empty or blank files', contents => {
    expect(readNight(log(contents), night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('returns null for a missing file', () => {
    expect(readNight(log(''), '2026-10-27')).toBeNull();
  });

  it.each(['../2026-10-28', '..\\2026-10-28', '2026-10-28/../x', '2026-02-29', '2026-04-31', '2026-1-01', '2026-10-28.jsonl', '0000-01-01', ''])('rejects invalid night %s', invalidNight => {
    // A traversal would otherwise read the valid log in the parent directory.
    const nested = join(log(JSON.stringify(event)), 'nested');
    mkdirSync(nested);
    expect(readNight(nested, invalidNight)).toBeNull();
  });

  it('propagates filesystem failures other than missing files', () => {
    const directory = join(log(''), 'nested');
    mkdirSync(join(directory, `${night}.jsonl`), { recursive: true });
    expect(() => readNight(directory, night)).toThrow();
  });
});
