# FINDINGS

Running log of mxcli/MDL bugs, surprises, and workarounds. Numbered, with the
exact command and output. Newest phase appended at the bottom.

---

## Phase 1 — toolchain setup (2026-07-28)

### 1. `mxcli`'s `go.mod` needs a newer Go than the base image ships

The base image has Go 1.24.7; `go.mod` asks for 1.26.

```
$ head -4 /opt/mxcli-src/go.mod
module github.com/mendixlabs/mxcli

go 1.26.0
toolchain go1.26.5
```

**Workaround:** export `GOTOOLCHAIN=auto` before building so `go` downloads and
uses the pinned toolchain. Without it the build aborts on a toolchain mismatch.
This is set inside `scripts/setup-tools.sh`; the image's `go env GOTOOLCHAIN`
already reports `auto`, but the script does not rely on that.

Note the module path is `github.com/mendixlabs/mxcli` even though the clone URL is
`github.com/ako/mxcli`. Not a problem, just surprising when reading build output.

### 2. The ANTLR-generated parser is not committed — it must be regenerated on every fresh clone

`mdl/grammar/parser/` is absent from a fresh clone, and `make build` depends on the
`grammar` target:

```
build: grammar sync-all completions
```

which is:

```
grammar:
	$(MAKE) -C mdl/grammar generate
```

`mdl/grammar/Makefile` resolves the generator with a bare `which`:

```
ANTLR4 := $(shell which antlr4 2>/dev/null || which antlr 2>/dev/null)

check-antlr:
ifndef ANTLR4
	$(error ANTLR4 not found. Install with: brew install antlr4 (macOS) or pip install antlr4-tools)
```

So an `antlr4` **command** must be on `PATH` — a jar alone is not enough.

**Workaround:** `/usr/local/bin/antlr4` shim that `exec java -jar`s the pinned jar.

### 3. The ANTLR version must be exactly 4.13.1

The generated parser links against the Go runtime pinned in `go.mod`:

```
github.com/antlr4-go/antlr/v4 v4.13.1
```

A different ANTLR generator version emits code that does not compile against that
runtime. The upstream devcontainer installs `antlr4-tools` via pip, which resolves
to whatever is current — not reproducible.

**Workaround:** pin the jar at `/opt/antlr/antlr-4.13.1-complete.jar` from Maven
Central, and have the verification step assert the version the shim *reports*, not
merely that the file exists.

### 4. `go build` is not sufficient — `make build` is required

`make build` runs three code-generation steps before compiling:

```
Generated Go parser in parser/
Synced 63 skill file(s)
Synced 10 command file(s)
Synced 29 lint rule file(s)
Generated cmd/mxcli/lsp_completions_gen.go.tmp with 565 keyword entries
```

A plain `go build ./cmd/mxcli` skips the grammar regeneration and the embedded
skills/commands/lint-rules, producing a binary with a stale or missing grammar.

### 5. `make build` warns about a missing `.vsix` — benign

```
Warning: No .vsix found. Creating empty placeholder.
```

The `sync-vsix` target embeds the VS Code extension. Building it needs `bun`, which
is not in this image. The target degrades to an empty placeholder and the build
succeeds. Only matters if `mxcli` is asked to install the VS Code extension.

### 6. `mx` has no `--version` flag

```
$ ~/.mxcli/mxbuild/11.12.1/modeler/mx --version
ERROR(S):
  Verb '--version' is not recognized.
```

`mx` is verb-based (`check`, `convert`, `create-project`, `show-version`, …). Use
`mx show-version` for the Studio Pro version that last edited an app. For a
liveness check, `test -x` on the binary is the reliable probe — a `--version` probe
exits non-zero and would produce a false "missing" verdict.

### 7. PostgreSQL server binaries are off `PATH`

`psql` resolves, but the server does not:

```
$ which postgres
/bin/bash: line 1: postgres: command not found
$ /usr/lib/postgresql/16/bin/postgres --version
postgres (PostgreSQL) 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
```

The `postgresql-16` package is installed and cluster `16/main` already exists,
initially stopped:

```
$ pg_lsclusters
Ver Cluster Port Status Owner    Data directory              Log file
16  main    5432 down   postgres /var/lib/postgresql/16/main /var/log/postgresql/postgresql-16-main.log
```

**Workaround:** verify against the absolute path `/usr/lib/postgresql/16/bin/postgres`
and drive the cluster with the Debian wrappers (`pg_ctlcluster 16 main start`)
rather than shadowing them with symlinks into `/usr/local/bin`.

### 8. `mxcli setup mxbuild/mxruntime` accept `--version`, so pre-caching needs no project

Useful for a cold-container hook, before any `.mpr` exists:

```
$ mxcli setup mxbuild --version 11.12.1
  Downloading MxBuild 11.12.1 for amd64...
  URL: https://cdn.mendix.com/runtime/mxbuild-11.12.1.tar.gz
  Size: 822.0 MB
  MxBuild cached at /root/.mxcli/mxbuild/11.12.1/modeler/mxbuild

$ mxcli setup mxruntime --version 11.12.1
  Downloading Mendix runtime 11.12.1...
  Size: 341.4 MB
  Runtime cached at /root/.mxcli/runtime/11.12.1
```

On-disk cost after extraction is larger than the download: 1.7 GB for mxbuild,
397 MB for the runtime.

`--force` exists on `setup mxbuild` but is only needed on Windows/macOS, where the
command otherwise refuses to fetch the Linux-only CDN binary. Do not pass it on
Linux.

### 9. `main` moves during a session — pin by SHA, not by branch name

`main` advanced between the first probe clone and the scripted build within the
same session:

```
e06015edc74e6e6925bfec769cba9ece3aa9073a   (probe clone, 14:49)
d8f383ab102a64a672673b4c55169183f547fc32   (scripted build, 15:05)
```

**Workaround:** `scripts/setup-tools.sh` resolves remote `main` with `git ls-remote`,
records the built commit in `/opt/mxcli-src/.installed-sha`, and rebuilds only on a
mismatch. "Is mxcli current?" is therefore a SHA comparison, not a guess.

### 10. GitHub is reachable over git but plain `curl` to github.com returns 403

```
$ curl -sS -o /dev/null -w "%{http_code}" https://github.com/ako/mxcli
403
$ git clone --depth 1 https://github.com/ako/mxcli.git
Cloning into 'mxcli'... done.
```

The agent proxy injects git credentials (`gitConfigInjection: true`) but blocks
unauthenticated browser-style fetches. Use `git`/`git ls-remote` for anything
GitHub-hosted; do not conclude from a `curl` 403 that the network is down.
Maven Central and the Mendix CDN are reachable by plain `curl`.

### 11. Not yet exercised

Carried forward — these are ground rules not yet verified in practice, listed so a
later phase knows they are untested here:

- `mxcli -c "REFRESH CATALOG FULL"` vs plain `REFRESH` (plain reportedly leaves
  `activities_data` and refs empty).
- `mx check` wedging a live `--watch` loop.
- `mxcli auth hub login` — expected to fail in this container, since GitHub's OAuth
  device-flow endpoints are unreachable. `MXCLI_HUB_KEY` must be minted at
  <https://hub.mxcli.org/cli> and supplied via the Claude Code environment
  configuration.
