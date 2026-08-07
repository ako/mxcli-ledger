# Toolchain

This workspace builds Mendix apps through [mxcli](https://github.com/ako/mxcli) and
MDL. The `.mpr` is never hand-edited and Studio Pro is never used.

## Why there is a setup script at all

The container is **ephemeral**. It is recycled between sessions, and when it comes
back:

- `/opt` is empty — no ANTLR jar, no mxcli clone.
- `/usr/local/bin` is empty — no `mxcli`, no `antlr4`.
- `~/.mxcli` is empty — no Mendix build engine, no Mendix runtime (~1.2 GB).
- Only the files committed to this repository survive.

So reproducibility comes from **committed files, not installed state**. Everything
the toolchain needs is re-derived by one script:

```
scripts/setup-tools.sh
```

It is idempotent and detect-then-install, so it is cheap on a warm container and
complete on a cold one. It runs automatically on session start (see *Hook wiring*
below) and is safe to run by hand at any time:

```bash
bash scripts/setup-tools.sh
```

## What the base image already provides

These are **detected, never reinstalled**:

| Component | Version | Notes |
|---|---|---|
| Go | 1.24.7 | mxcli's `go.mod` asks for a newer toolchain — see below |
| JDK | 21.0.10 (OpenJDK) | required by MxBuild and by the ANTLR jar |
| Node | 22.22.2 (npm 10.9.7) | Playwright / screenshot support |
| PostgreSQL | 16.13 | server + client, see *PostgreSQL* below |
| Chromium | Playwright build 1194 | `/opt/pw-browsers/chromium` |

`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is already set in the environment.
**Never run `playwright install`** — the browser is pre-provisioned and the
download is blocked.

### Go toolchain

`mxcli`'s `go.mod` declares `go 1.26.0` / `toolchain go1.26.5`, which is newer than
the image's Go 1.24.7. The script exports `GOTOOLCHAIN=auto` so `go` downloads and
uses the pinned toolchain instead of refusing to build. Without it the build fails
immediately with a toolchain-mismatch error.

### PostgreSQL

The Debian packaging keeps the server binaries **off `PATH`**: `psql` is at
`/usr/bin/psql`, but `postgres`, `initdb`, and `pg_ctl` live in
`/usr/lib/postgresql/16/bin`. A cluster `16/main` is already created (initially
`down`). Use the Debian wrappers rather than adding the bindir to `PATH`:

```bash
pg_lsclusters                  # status
pg_ctlcluster 16 main start    # start
```

`mxcli run --local --ensure-db` handles the database itself; the above is for
manual inspection.

## What the script installs

### 1. ANTLR 4.13.1 (pinned)

- jar: `/opt/antlr/antlr-4.13.1-complete.jar` (from Maven Central)
- shim: `/usr/local/bin/antlr4`, which `exec java -jar`s that jar

mxcli's `make grammar` target shells out to a bare `antlr4` command
(`mdl/grammar/Makefile`) and the generated Go parser is **not** committed upstream —
it has to be regenerated on every fresh clone. The version is pinned because the
generated parser must match the `github.com/antlr4-go/antlr/v4 v4.13.1` runtime
mxcli depends on; any other ANTLR version produces a parser that fails to compile.
The verification step therefore checks the version the shim *reports*, not just
that the file exists.

### 2. mxcli, built from source

Cloned from `https://github.com/ako/mxcli.git` at `main` into `/opt/mxcli-src`,
built with `make build`, installed to `/usr/local/bin/mxcli`.

`make build` — not a plain `go build` — is what runs, in order: ANTLR grammar
generation, embedding of skills/commands/lint-rules, and regeneration of the LSP
completion table. A plain `go build` skips all of that and yields a binary with a
stale or missing grammar.

**Rebuild detection.** The installed commit is recorded in
`/opt/mxcli-src/.installed-sha`. On each run the script resolves remote `main` with
`git ls-remote` and rebuilds only when the two differ. If the network is
unreachable but a binary is already installed, it warns and keeps the existing
build rather than failing the session.

Cold build cost: roughly 2 minutes, most of it fetching the Go 1.26.5 toolchain and
the module graph.

### 3. Mendix engine + runtime pre-cache

Target version **11.13.0**, pre-fetched so the first build of a session is not a
cold download:

```
mxcli setup mxbuild  --version 11.13.0   # ~1.7 GB → ~/.mxcli/mxbuild/11.13.0
mxcli setup mxruntime --version 11.13.0  # ~397 MB → ~/.mxcli/runtime/11.13.0
```

This gives `mx` (the validator) at
`~/.mxcli/mxbuild/11.13.0/modeler/mx` and `mxbuild` beside it.

Override with `MENDIX_VERSION=… bash scripts/setup-tools.sh`, or skip the download
entirely with `SKIP_MENDIX_CACHE=1`.

### 4. Verification

The script ends by asserting each component is present and prints a version
summary. Anything missing prints a `MISSING` line and the script exits non-zero, so
a broken toolchain is loud rather than discovered later mid-build.

## Hook wiring

`.claude/settings.json` registers `scripts/setup-tools.sh` as a `SessionStart`
hook with a 900 s timeout (a cold container needs the build plus ~1.2 GB of
downloads).

> **When a later phase adds a script that launches the app, chain it into the SAME
> hook command with `&&` — do not add a second entry to the array.**
>
> ```json
> "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/setup-tools.sh\" && bash \"$CLAUDE_PROJECT_DIR/scripts/run-app.sh\""
> ```
>
> Two entries in one `SessionStart` `hooks` array run **concurrently, not
> sequentially**. That race launches the app against the previous `mxcli` binary
> while the rebuild is still replacing it. The symptom is invisible — the running
> process simply holds a deleted inode, so it keeps working while behaving like the
> old build.

## What is deliberately not committed

Per `.gitignore`: binaries, the mxcli clone, the ANTLR jar, `*.mda`, and
`deployment/`. These are all large, machine-specific, or regenerable. A gitignored
credentials file would be equally pointless — it would not survive container
recycling either.

## Hub credentials

`MXCLI_HUB_URL`, `MXCLI_HUB_KEY`, and `MXCLI_HUB_SECRET` come from the Claude Code
**environment configuration**, never from a committed or gitignored file.

`MXCLI_HUB_KEY` must be minted in a browser at <https://hub.mxcli.org/cli>. The
container cannot reach GitHub's OAuth device-flow endpoints, so
`mxcli auth hub login` **cannot complete here** — do not try to run it.

## Ground rules for authoring

These apply to every later phase:

- mxcli's default engine is `modelsdk`. **Do not** pass `--engine legacy`.
- Author everything in `.mdl` files under `<App>/mdlsource/`, numbered so they
  apply in dependency order. Re-apply them from scratch rather than patching
  the `.mpr`.
- Use `mxcli -c "REFRESH CATALOG FULL"` — a plain `REFRESH` leaves `activities_data`
  and refs empty.
- Never run `mx check` while a `--watch` loop is live; it wedges the loop.
- Use anchored `pgrep`/`pkill` patterns (e.g. `^mxcli run`). A bare
  `pgrep -f mxcli` matches the invoking shell and kills the command chain.
- Record every mxcli bug, surprise, or workaround in `FINDINGS.md`, numbered, with
  the exact command and its output.
