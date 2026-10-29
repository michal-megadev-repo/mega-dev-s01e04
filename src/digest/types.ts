/** The status of one valid run-log event. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/** One job's valid events, aggregated in their original file order. */
export interface DigestRow {
  job: string;
  /** Owner on the job's last event, including an explicit null. */
  owner: string | null;
  /** Number of valid events for this job, including retry events. */
  runs: number;
  /** Number of those events whose status is retry. */
  retries: number;
  lastStatus: RunStatus;
  /** Latest supplied error in file order; recovery does not clear it. */
  lastError: string | null;
  /** Original at string on the first event; retain its timezone offset. */
  firstAt: string;
  /** Original at string on the last event; retain its timezone offset. */
  lastAt: string;
  /** True if any event failed, even when the job subsequently recovered. */
  hasFailure: boolean;
}

/** Counts of raw valid events, not counts of jobs or their final statuses. */
export interface DigestCounts {
  ok: number;
  retry: number;
  fail: number;
}

/** An existing night's log, including an empty or entirely malformed file. */
export interface NightDigest {
  night: string;
  /** One row per job, ascending by job using code-unit string comparison. */
  rows: DigestRow[];
  /** Nonblank lines with invalid JSON or invalid event fields; blanks are ignored. */
  badLines: number;
  counts: DigestCounts;
}

/**
 * Synchronously read runsDir/<night>.jsonl. The runtime implementation is exported
 * from reader.ts; this module provides only the shared type contract.
 *
 * Return null for a missing file or a night that is not a real calendar date in
 * YYYY-MM-DD form. Other filesystem errors propagate. An empty file returns a
 * digest with empty rows and zero counts.
 *
 * Each valid event has a nonempty job, a valid timestamp with an explicit offset
 * (or Z), a RunStatus, an owner that is a string or null, and an optional string
 * error. Malformed events increment badLines and do not affect rows or counts.
 * File order determines first/last events, owner, status, and the latest supplied
 * error, even if timestamps are out of order. Never normalize timestamp strings
 * or convert their offsets for display. Missing errors yield lastError: null
 * until an event supplies an error.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
