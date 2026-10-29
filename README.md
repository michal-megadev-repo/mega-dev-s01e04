# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
(next) a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

## Digest preview

To export one local copy for inspection, start rig with the marker configured and save the page:

```sh
mkdir -p var/preview
pnpm start >var/preview/server.log 2>&1 &
server_pid=$!
curl --fail --silent --show-error http://127.0.0.1:8787/digest/2026-10-28 \
  --output var/preview/index.html
kill "$server_pid"
rm -f var/preview/server.log
```

`var/` is ignored; never commit the exported HTML. Public previews follow [the preview decision](docs/adr/0003-previews-are-public-and-short-lived.md) and the cleanup step in [plan §3–4](plan.md). To publish, manually run **Publish digest preview** from the repository's Actions tab and choose `include`; the workflow reads the marker only from the `LANE_MARKER` repository secret and publishes the single HTML page to GitHub Pages. The workflow is manual-only, so a push cannot replace the public page. Do not choose `removed` to replace a marked preview until the separate cleanup approval is given.
