#!/usr/bin/env bash
#
# setup-tools.sh — re-establish the Mendix/mxcli toolchain in an ephemeral container.
#
# This container is recycled between sessions. Nothing under /opt, ~/.mxcli, or
# /usr/local/bin survives. This script is the reproducible source of truth: it is
# idempotent and detect-then-install, so it is cheap to re-run on every session
# start and expensive only on a cold container.
#
# It is wired to SessionStart via .claude/settings.json.
#
# IMPORTANT (hook wiring): when a later phase adds a script that launches the app,
# chain it into the SAME hook command with `&&`:
#
#     bash "$CLAUDE_PROJECT_DIR/scripts/setup-tools.sh" && bash "$CLAUDE_PROJECT_DIR/scripts/run-app.sh"
#
# Two entries in one SessionStart hooks array run CONCURRENTLY, not sequentially.
# That race launches the app against the previous mxcli binary while the rebuild is
# still replacing it, and the symptom is invisible — the process just holds a
# deleted inode.
#
# Environment overrides:
#   MENDIX_VERSION   Mendix version to pre-cache (default 11.14.0)
#   MXCLI_REF        git ref of mxcli to build (default main)
#   SKIP_MENDIX_CACHE=1   skip the ~1.2 GB engine/runtime download

set -euo pipefail

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
MENDIX_VERSION="${MENDIX_VERSION:-11.14.0}"

ANTLR_VERSION="4.13.1"
ANTLR_DIR="/opt/antlr"
ANTLR_JAR="${ANTLR_DIR}/antlr-${ANTLR_VERSION}-complete.jar"
ANTLR_URL="https://repo1.maven.org/maven2/org/antlr/antlr4/${ANTLR_VERSION}/antlr4-${ANTLR_VERSION}-complete.jar"
ANTLR_SHIM="/usr/local/bin/antlr4"

MXCLI_REPO="https://github.com/ako/mxcli.git"
MXCLI_REF="${MXCLI_REF:-main}"
MXCLI_SRC="/opt/mxcli-src"
MXCLI_BIN="/usr/local/bin/mxcli"
MXCLI_STAMP="/opt/mxcli-src/.installed-sha"

MXCLI_HOME="${HOME}/.mxcli"
MXBUILD_DIR="${MXCLI_HOME}/mxbuild/${MENDIX_VERSION}"
MX_BIN="${MXBUILD_DIR}/modeler/mx"
MXBUILD_BIN="${MXBUILD_DIR}/modeler/mxbuild"
RUNTIME_DIR="${MXCLI_HOME}/runtime/${MENDIX_VERSION}"

# The go.mod toolchain directive pins a newer Go than the base image ships.
# GOTOOLCHAIN=auto lets `go` fetch and use it instead of refusing to build.
export GOTOOLCHAIN=auto

# Debian keeps the PostgreSQL server binaries off PATH; the client is on PATH.
PG_BINDIR="/usr/lib/postgresql/16/bin"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[33m    WARNING: %s\033[0m\n' "$*" >&2; }
err()  { printf '\033[31m    ERROR: %s\033[0m\n' "$*" >&2; }

# retry <description> <command...> — 4 retries, exponential backoff (2/4/8/16s).
retry() {
    local desc="$1"; shift
    local delay=2 attempt=1
    until "$@"; do
        if [ "$attempt" -ge 5 ]; then
            err "${desc}: failed after 5 attempts"
            return 1
        fi
        warn "${desc}: attempt ${attempt} failed, retrying in ${delay}s"
        sleep "$delay"
        delay=$(( delay * 2 ))
        attempt=$(( attempt + 1 ))
    done
}

# --------------------------------------------------------------------------
# 1. Report what the base image already provides (never reinstall these)
# --------------------------------------------------------------------------
say "Base image toolchain"
info "go        : $(go version 2>/dev/null | awk '{print $3}' || echo MISSING)"
info "java      : $(java -version 2>&1 | awk -F'\"' '/version/{print $2; exit}' || echo MISSING)"
info "node      : $(node --version 2>/dev/null || echo MISSING)"
info "npm       : $(npm --version 2>/dev/null || echo MISSING)"
info "postgres  : $("${PG_BINDIR}/postgres" --version 2>/dev/null | awk '{print $3}' || echo MISSING)"
info "chromium  : ${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}/chromium"

# --------------------------------------------------------------------------
# 2. ANTLR 4.13.1 — mxcli's `make grammar` shells out to an `antlr4` command.
#    Any other ANTLR version generates a parser mxcli will not compile against.
# --------------------------------------------------------------------------
say "ANTLR ${ANTLR_VERSION}"
if [ -s "$ANTLR_JAR" ]; then
    info "jar already present: ${ANTLR_JAR}"
else
    info "downloading ${ANTLR_URL}"
    mkdir -p "$ANTLR_DIR"
    retry "antlr jar download" \
        curl -fsSL --retry 3 -o "${ANTLR_JAR}.tmp" "$ANTLR_URL"
    mv "${ANTLR_JAR}.tmp" "$ANTLR_JAR"
    info "jar installed: ${ANTLR_JAR}"
fi

# Shim is cheap; rewrite unconditionally so it always points at the pinned jar.
cat > "$ANTLR_SHIM" <<EOF
#!/usr/bin/env bash
# Pinned ANTLR ${ANTLR_VERSION} — installed by scripts/setup-tools.sh
exec java -jar ${ANTLR_JAR} "\$@"
EOF
chmod 755 "$ANTLR_SHIM"
info "shim installed: ${ANTLR_SHIM}"

# --------------------------------------------------------------------------
# 3. mxcli — build from source at the tip of main.
#    Skip the (~2 min) build when the installed binary already matches remote HEAD.
# --------------------------------------------------------------------------
say "mxcli (${MXCLI_REPO} @ ${MXCLI_REF})"

# Empty on network failure — handled below rather than aborting, so an offline
# session with an already-good binary still starts.
remote_sha=$(retry "git ls-remote mxcli" \
    git ls-remote "$MXCLI_REPO" "$MXCLI_REF" 2>/dev/null | awk 'NR==1{print $1}' || true)

installed_sha=""
[ -f "$MXCLI_STAMP" ] && installed_sha=$(cat "$MXCLI_STAMP")

if [ -z "$remote_sha" ]; then
    if [ -x "$MXCLI_BIN" ]; then
        warn "could not resolve remote HEAD; keeping installed build ${installed_sha:-unknown}"
    else
        err "could not resolve remote HEAD and no mxcli is installed"
        exit 1
    fi
elif [ -x "$MXCLI_BIN" ] && [ "$installed_sha" = "$remote_sha" ]; then
    info "up to date at ${remote_sha} — skipping build"
else
    if [ -n "$installed_sha" ]; then
        info "installed ${installed_sha} != remote ${remote_sha} — rebuilding"
    else
        info "building ${remote_sha}"
    fi

    if [ -d "${MXCLI_SRC}/.git" ]; then
        retry "git fetch mxcli" \
            git -C "$MXCLI_SRC" fetch --depth 1 origin "$MXCLI_REF"
        git -C "$MXCLI_SRC" reset --hard FETCH_HEAD --quiet
    else
        rm -rf "$MXCLI_SRC"
        retry "git clone mxcli" \
            git clone --depth 1 --branch "$MXCLI_REF" "$MXCLI_REPO" "$MXCLI_SRC"
    fi

    built_sha=$(git -C "$MXCLI_SRC" rev-parse HEAD)

    # `make build` runs the ANTLR grammar generation, embeds skills/commands/lint
    # rules, and regenerates the LSP completion table. Plain `go build` skips all
    # of that and produces a binary with a stale grammar.
    info "make build (this pulls the go.mod toolchain on a cold container)"
    make -C "$MXCLI_SRC" build

    install -m 755 "${MXCLI_SRC}/bin/mxcli" "$MXCLI_BIN"
    printf '%s\n' "$built_sha" > "$MXCLI_STAMP"
    info "installed ${MXCLI_BIN} @ ${built_sha}"
fi

# --------------------------------------------------------------------------
# 4. Pre-cache the Mendix build engine (MxBuild + mx) and runtime, so the first
#    build of the session is not a ~1.2 GB cold download.
# --------------------------------------------------------------------------
say "Mendix ${MENDIX_VERSION} engine + runtime"
if [ "${SKIP_MENDIX_CACHE:-0}" = "1" ]; then
    info "SKIP_MENDIX_CACHE=1 — skipping"
else
    if [ -x "$MXBUILD_BIN" ] && [ -x "$MX_BIN" ]; then
        info "mxbuild already cached: ${MXBUILD_DIR}"
    else
        retry "mxbuild download" \
            mxcli setup mxbuild --version "$MENDIX_VERSION"
    fi

    if [ -d "${RUNTIME_DIR}/runtime" ]; then
        info "runtime already cached: ${RUNTIME_DIR}"
    else
        retry "runtime download" \
            mxcli setup mxruntime --version "$MENDIX_VERSION"
    fi
fi

# --------------------------------------------------------------------------
# 5. Verify — fail loudly on anything missing.
# --------------------------------------------------------------------------
say "Verification"
failures=0
check() { # check <label> <test-expression...>
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then
        info "OK    ${label}"
    else
        err "MISSING ${label}"
        failures=$(( failures + 1 ))
    fi
}

check "mxcli runs"                     mxcli --version
check "antlr4 shim"                    test -x "$ANTLR_SHIM"
check "antlr jar (${ANTLR_VERSION})"   test -s "$ANTLR_JAR"
check "mx validator"                   test -x "$MX_BIN"
check "mxbuild engine"                 test -x "$MXBUILD_BIN"
check "Mendix runtime"                 test -d "${RUNTIME_DIR}/runtime"
check "postgres server"                test -x "${PG_BINDIR}/postgres"
check "psql client"                    command -v psql
check "chromium"                       test -x "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}/chromium"
check "java"                           command -v java
check "go"                             command -v go
check "node"                           command -v node

# The shim must resolve to the pinned version — a different ANTLR silently
# generates a parser that fails to compile against mxcli's antlr4-go runtime.
antlr_reported=$("$ANTLR_SHIM" 2>/dev/null | awk '/^ANTLR Parser Generator/{print $NF; exit}')
if [ "$antlr_reported" = "$ANTLR_VERSION" ]; then
    info "OK    antlr4 reports ${antlr_reported}"
else
    err "MISSING antlr4 reports '${antlr_reported:-nothing}', expected ${ANTLR_VERSION}"
    failures=$(( failures + 1 ))
fi

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
say "Version summary"
printf '    %-22s %s\n' "go"              "$(go version 2>/dev/null | awk '{print $3}')"
printf '    %-22s %s\n' "java"            "$(java -version 2>&1 | awk -F'\"' '/version/{print $2; exit}')"
printf '    %-22s %s\n' "node"            "$(node --version 2>/dev/null)"
printf '    %-22s %s\n' "postgres"        "$("${PG_BINDIR}/postgres" --version 2>/dev/null | awk '{print $3}')"
printf '    %-22s %s\n' "antlr4"          "${antlr_reported:-unknown}"
printf '    %-22s %s\n' "mxcli"           "$(mxcli --version 2>/dev/null | head -1)"
printf '    %-22s %s\n' "mxcli HEAD"      "$(cat "$MXCLI_STAMP" 2>/dev/null || echo unknown)"
printf '    %-22s %s\n' "mendix engine"   "${MENDIX_VERSION} (${MXBUILD_DIR})"
printf '    %-22s %s\n' "mendix runtime"  "${MENDIX_VERSION} (${RUNTIME_DIR})"
printf '    %-22s %s\n' "chromium"        "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}/chromium"

if [ "$failures" -gt 0 ]; then
    err "${failures} toolchain component(s) missing — see MISSING lines above"
    exit 1
fi

say "Toolchain ready"
