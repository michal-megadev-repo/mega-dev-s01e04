import type { NightDigest } from '../digest/types.js';

const missing = '—';

export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      {digest.badLines > 0 && (
        <p class="warn">{digest.badLines} malformed {digest.badLines === 1 ? 'line' : 'lines'} skipped.</p>
      )}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>job</th><th>owner</th><th>runs</th><th>retries</th>
                <th>last status</th><th>last error</th><th>first time</th><th>last time</th>
              </tr>
            </thead>
            <tbody>
              {digest.rows.map((row) => {
                const warn = row.retries >= 3 || row.hasFailure || row.lastStatus === 'fail';
                return (
                  <tr class={warn ? 'warn' : undefined}>
                    <td>{row.job}</td>
                    <td>{row.owner == null || row.owner.trim() === '' ? missing : row.owner}</td>
                    <td>{row.runs}</td>
                    <td>{row.retries}</td>
                    <td>{row.lastStatus}</td>
                    <td>{row.lastError || missing}</td>
                    <td>{row.firstAt}</td>
                    <td>{row.lastAt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
