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

---

## Phase 2 — domain model and demo data (2026-07-28)

### 12. `DELETE_CASCADE` is documented but the grammar rejects it

`docs/05-mdl-specification/03-domain-model.md` lists `DELETE_CASCADE` in the
delete-behavior table. The parser disagrees:

```
$ ./mxcli check mdlsource/01-domain-model.mdl
  - line 235:18 missing {DELETE_AND_REFERENCES, DELETE_BUT_KEEP_REFERENCES,
    DELETE_IF_NO_REFERENCES, CASCADE, PREVENT} at 'DELETE_CASCADE'
```

**Workaround:** use `CASCADE`. The error message is the authoritative list.

### 13. Association direction is inverted relative to the documented example — and only `mx check` catches it

This one cost the most time, because `mxcli check` passes and the model looks
right in `SHOW ASSOCIATIONS`.

The spec's table and its example contradict each other:

| Property | MDL Clause | Description |
|----------|------------|-------------|
| Parent | `from entity` | Parent (**owner/many**) side of relationship |
| Child | `to entity` | Child (referenced/**one**) side |

but the example immediately below reads:

```sql
/** Order belongs to Customer (many-to-one) */
create association Sales.Order_Customer
  from Sales.Customer      -- the ONE side
  to Sales.Order           -- the MANY side
```

The table is right and the example is wrong. `from` must be the entity that
**owns the reference** (the many side). Following the example produces an
association that `mxcli check` accepts and `SHOW ASSOCIATIONS` renders happily,
but every microflow that sets it fails validation:

```
$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check Ledger.mpr
[error] [CE0854] "Association 'Ledger.Transaction_Account' is not reachable
  from entity 'Ledger.Transaction'." at Change object activity
  'Change 'Tx' (Transaction_Account)'
...
The app contains: 76 errors.
```

68 of those 76 errors were this single mistake, repeated.

**Workaround:** write `from <child/many> to <parent/one>`. `create or modify`
will not flip an existing association — it must be dropped and recreated:

```
./mxcli -p Ledger.mpr -c "DROP ASSOCIATION Ledger.Transaction_Account"
```

### 14. Scripts are not re-runnable unless every statement says `create or modify`

The ground rule is to re-apply MDL from scratch rather than patch the `.mpr`,
but a plain `create` is not idempotent:

```
$ ./mxcli exec mdlsource/01-domain-model.mdl
Error: enumeration already exists: Ledger.AccountType (use create or modify to update)
  hint: Ledger.Account is defined later in this script — move its create statement before this one
```

The hint is misleading — it points at an unrelated entity and suggests
reordering, which is not the fix. The message before it is the real one.

**Workaround:** use `create or modify` on every enumeration, entity,
association and microflow. Associations still cannot change direction this way
(see 13).

### 15. Every `create` in a microflow needs a distinct output variable

Reusing a scratch variable across creates is rejected:

```
$ ./mxcli check mdlsource/02-seed-reference.mdl -p Ledger.mpr --references
  - duplicate variable name '$M' — create output variable is already declared in this scope (CE0111)
  [... x34]
```

**Workaround:** number them (`$M1`…`$M35`). Verbose, but there is no scoping
construct that would let a name be reused.

### 16. mxcli accepts expression functions that Mendix does not have

`year()` and `month()` are in mxcli's function whitelist
(`mdl/exprcheck/func_checker.go`) and pass `mxcli check --references` cleanly.
Mendix has no such functions, so the build fails later:

```
[error] [CE0117] "Error(s) in expression." at Change variable activity 'Change variable Year'
[error] [CE0117] "Error(s) in expression." at Change variable activity 'Change variable ThroughMonth'
```

**Workaround:** format and re-parse.

```
set $Year = parseInteger(formatDateTime([%CurrentDateTime%], 'yyyy'));
set $Month = parseInteger(formatDateTime([%CurrentDateTime%], 'M'));
```

### 17. BUG: division by a variable silently loses the `$` sigil

Written:

```
set $B02 = $Dec / $Dec2;
```

Stored in the model (via `DESCRIBE MICROFLOW`):

```
set $B02 = $Dec/Dec2;
```

The `$` on the right operand of `/` is eaten, producing an unresolvable
expression. `mxcli check` passes; `mx check` reports only the generic
CE0117 "Error(s) in expression", with no indication that the text was
rewritten. `DESCRIBE MICROFLOW` is the only way to see it.

**Workaround:** never divide by a variable. Multiply by a reciprocal instead,
passing it in as a Decimal parameter if necessary.

### 18. BUG: decimal literals with a zero fraction are truncated to integers

Written `$Dec / 2.0`, stored as `$Dec / 2` — which then fails Mendix's
type rules (see 20). Same for `100.0` → `100`.

**Workaround:** avoid `X.0` literals entirely; use a multiplication by
`0.01`/`0.001` instead of a division by `100.0`/`1000.0`.

### 19. BUG: small decimal literals are emitted in scientific notation

Written `$Dec * $I * $I * 0.000001`, stored as `$Dec * $I * $I * 1e-06`.
Mendix expressions do not accept `1e-06`, so this fails CE0117.

`0.001` survives correctly, so the threshold is somewhere between.

**Workaround:** keep literals at `0.001` or larger, applying them more than
once where a smaller scale factor is needed:

```
-- instead of  * 0.000001
* ($DriftPermille * 0.001) * ($FactorPermille * 0.001)
```

### 20. Mendix division requires BOTH operands to be Decimal

Not an mxcli issue, but it shapes every calculation. All of these fail CE0117:

| Expression | Result |
|---|---|
| `$Integer / 1000` | fails (even into a Decimal variable) |
| `$Decimal / 2` | fails |
| `$Integer / 1000.0` | fails |
| `$Decimal * $Integer` | **works** |
| `$Integer * 9.4` | **works** |
| `round($Dec * $I * 0.001, 2)` | **works** |

Multiplication mixes types freely; division does not mix at all.

**Workaround:** express every ratio as a multiplication. Where a true division
is unavoidable, pass the reciprocal in as a Decimal parameter — this is why
`Seed_CategoryTransactions` takes `$SharePerTx` (1/n) rather than computing it
from `$TxPerMonth`.

### 21. `dateTime()` only accepts literal constants

```
set $C01 = dateTime(2026, 7, 15);        -- works
set $C02 = dateTime(2026, $Month, $Day); -- CE0117
```

**Workaround:** step off a literal anchor date.

```
set $TxDate = addDays(addMonths(dateTime(2026, 1, 1), $Month - 1), $Day - 1);
```

### 22. Working rule: `mxcli check` is necessary but not sufficient

Findings 13, 16, 17, 18, 19, 20 and 21 all pass `mxcli check --references`
and fail `mx check`. Treat `mxcli check` as a syntax gate only, and run

```
~/.mxcli/mxbuild/11.12.1/modeler/mx check Ledger.mpr
```

after every `exec`. When CE0117 appears, `DESCRIBE MICROFLOW <name>` to see
what was actually written to the model — the stored text is not always the text
that was authored (17, 18, 19).

Isolating CE0117 is easiest with a throwaway probe microflow that assigns each
candidate expression to its own uniquely-named variable, since `mx check`
reports the variable name but not the expression.

### 23. Uncommitted objects break the next `retrieve` — with a misleading error

`Seed_ReferenceData` created categories, merchants, overrides and rules with
`create` + `change`, but only committed the accounts and groups. Everything
uncommitted stayed out of the database, so the retrieves in `Seed_DemoData`
returned nothing and the app failed to boot:

```
2026-07-28 16:11:19.841 INFO  - LedgerSeed: Reference data created
2026-07-28 16:11:20.030 ERROR - Core: An exception occurred while running the after-startup-action.
com.mendix.modules.microflowengine.MicroflowException: Failed to evaluate expression,
error occurred on line 1, character 7
round($Category/BaselineBudget * $SharePerTx
      ^
Caused by: ExpressionException: Left and right hand side of binary expression should not be empty
```

The message points at the arithmetic, which is fine — the real problem is that
`$Category` is empty two microflows upstream. `mx check` cannot catch this; it
only shows up at runtime.

**Workaround:** commit every object a later `retrieve` depends on. The
`@annotation` on the guard is not enough — the guard checked `Account`, which
*was* committed, so a partially-seeded database also silently suppressed
re-seeding on the next boot. Drop and recreate the database when a seed run
fails halfway:

```
su postgres -c "psql -c 'DROP DATABASE IF EXISTS ledger;'"
su postgres -c "psql -c 'CREATE DATABASE ledger OWNER mendix;'"
```

### 24. BUG: `navigationlist` loses every item name and generates unnamed Text widgets

Authored:

```
navigationlist navLedger {
  item itemTransactions (caption: 'Transactions', action: show_page Ledger.Transaction_Overview)
  ...
}
```

Stored (via `DESCRIBE SNIPPET`):

```
navigationlist navLedger {
  item  (Action: show_page 'Ledger.Transaction_Overview') {
    dynamictext  (Content: 'Transactions')
  }
  ...
}
```

Both the `item` name and the generated caption `dynamictext` name are empty,
so every item fails validation and they collide with each other:

```
[error] [CE0495] "Duplicate name ''." at Text '', Text ''
[error] [CE7247] "The name cannot be empty." at Text ''   (x3)
```

**Workaround:** build sidebar navigation from `actionbutton`s inside a
`container` instead. `action: show_page Module.Page` works there and the names
survive.

### 25. XPath has no `= empty` for associations

```
where [Ledger.Transaction_Category = empty]
  -> [error] [CE0161] "Error(s) in XPath constraint." at Data grid 2 'dgNeedsReview'
```

**Workaround:** test for the absence of the associated object.

```
where [not(Ledger.Transaction_Category/Ledger.Category)]
```

### 26. `contentparams` accepts attribute names only, never expressions

```
contentparams: [{2} = formatDateTime($currentObject/LastImport, 'd MMM yyyy')]
```

is stored as if the whole expression were an attribute name, and fails:

```
[error] [CE1613] "The selected attribute
  'Ledger.Account.formatDateTime($currentObject/LastImport,'d MMM yyyy')'
  no longer exists." at Text 'txtFooter'
```

**Workaround:** bind the bare attribute and accept the default formatting, or
add a derived string attribute and format it in a microflow.

### 27. Consecutive `dynamictext` widgets render inline regardless of `RenderMode`

Two sibling dynamictexts inside a container produced
`This month: € 310Last import: 7/24/2026` — no separator, values fused.
`rendermode: paragraph` is stored correctly (confirmed with `DESCRIBE PAGE`)
and passes `mx check`, but does not make them block-level.

**Workaround:** merge them into a single widget with two content params, or
wrap each in its own `container`.

### 28. Anchored pgrep patterns matter — demonstrated

The ground rule is real. With the app running as `./mxcli run --local`:

```
$ pgrep -a -f "mxcli run"
430  ./mxcli run --local          <- the app
4727 /bin/bash -c ... pgrep -a -f "mxcli run" ...   <- this very command
```

A bare `pkill -f "mxcli run"` would kill the invoking shell and take the rest
of the command chain with it. Note also that `^/.*mxcli run --local` matches
nothing, because the process command line is the relative `./mxcli`. The
pattern that works here is:

```
pkill -f "^\./mxcli run --local"
```

---

## Verification against ako/mxcli PR #52 (2026-07-28)

PR #52 (`537137b`, "check-time advisories for Mendix expression/XPath/layout
gotchas") targets findings 12-27 directly — its bug-test files are named
`ledger-17-slash-division.fail.mdl`, `ledger-21-datetime-literals.fail.mdl`,
`ledger-25-xpath-assoc-empty.fail.mdl` and so on.

Tested by building the PR in a separate worktree (`/opt/mxcli-pr52`, installed
as `mxcli-pr52`) so the SHA-tracked `/opt/mxcli-src` used by
`scripts/setup-tools.sh` stays untouched. Baseline confirmed first: current
`main` (`ead8926`) passes every one of these probes silently.

`make test` on the PR: **0 failures**.

### Fixed and verified

| # | Finding | Status under PR #52 |
|---|---------|---------------------|
| 12 | `DELETE_CASCADE` | Docs now list `CASCADE` and state "there is **no** `DELETE_CASCADE`" |
| 13 | Association direction | Table now says `from` = "the entity that **owns the foreign key**"; the misleading example is corrected to `from Sales.Order to Sales.Customer` |
| 16 | `year()` / `month()` | Rejected at check time — **MDL044** |
| 18 | `2.0` truncated to `2` | Fixed; `$Dec * 2.0` now round-trips intact |
| 19 | `0.000001` → `1e-06` | Fixed; the literal survives and `mx check` accepts it |
| 21 | `dateTime()` with variables | Rejected at check time — **MDL046**, and the hint gives the exact `addDays(addMonths(...))` workaround |
| 24 | `navigationlist` item names | Fixed at write time. Names are preserved and the generated caption gets a derived name (`text_itemAcc`); `mx check` passes |
| 25 | XPath `= empty` on an association | Rejected — **MDL047** (but see gap below) |
| 26 | Expression in `contentparams` | Rejected — **MDL-WIDGET14** |
| 27 | Consecutive `dynamictext` | Advisory — **MDL-WIDGET15** (info level) |

### Finding 20 was wrong — corrected

My original conclusion ("Mendix division requires BOTH operands to be Decimal")
was a wrong inference from correct observations. The real rule, which the PR's
**MDL045** states plainly:

> `/` navigates associations, it does not divide. Use `div` for division.

`div` handles mixed types without complaint. All of these are valid:

```
set $D2 = $Dec div $I;          -- Decimal div Integer
set $D3 = $I div 1000;          -- Integer div Integer
set $D5 = round($Dec div $I, 2);
```

Division always yields a Decimal, so the target variable must be Decimal —
that part of the original finding stands.

**Consequence for this project:** the `$SharePerTx` parameter existed only to
work around a rule that does not exist. `Seed_CategoryTransactions` now divides
directly (`$Category/BaselineBudget div $TxPerMonth`), the parameter is gone
from the signature and all 13 call sites, and a re-seed against a dropped
database produces **identical** output — 334 transactions, same per-month
counts, same net sums.

### Not fixed: finding 17 is still silent, and now falls through the new check too

This is the one to flag back. `$A / $B` — division by a *variable* — still
serializes with the `$` sigil eaten:

```
authored:  set $S1 = $Dec / $Dec2;
stored:    set $S1 = $Dec/Dec2;
mx check:  [error] [CE0117] "Error(s) in expression." at Change variable 'S1'
```

MDL045 fires for `$Dec / 2.0` and `$I / 1000` but **not** for `$Dec / $Dec2`.
The reason is visible in MDL045's own wording: `/` is association navigation,
so `$Dec/Dec2` parses as a perfectly well-formed attribute path and never looks
like a division to the checker. The result is that the most dangerous form —
the one that silently rewrites your expression — is the only one still not
caught.

A check for "`/` followed by a `$`-sigilled operand" would close it, since an
association path never has `$` on its right-hand side.

### Two smaller gaps

**MDL047 only covers microflow `retrieve`.** The PR's test uses
`retrieve $t from Ledger.Transaction where [Ledger.Transaction_Category = empty]`.
The same constraint in a *page datasource* is not flagged:

```
datagrid dgProbe (
  datasource: database from Ledger.Transaction
    where [Ledger.Transaction_Category = empty]   -- not flagged
)
```

That is exactly where this project originally hit it (finding 25) — a
`datagrid` on `Transaction_Overview`, not a microflow.

**MDL-WIDGET15 has false positives.** It flags any two adjacent
`dynamictext` widgets, including heading + subtitle pairs where the first has
`RenderMode: H2`/`H3`/`H4`. Those render block-level and are fine — verified
visually on all three Ledger pages. Running the real `05-pages-foundation.mdl`
through the PR build reports 4 such advisories, all benign. Restricting the
rule to cases where *both* widgets are non-heading would remove the noise.
Being info-level, it does not block anything.

### Round 2 — PR #52 at `f297447`

`f297447` ("close verification-round gaps in ledger checks (#17/#25/#27)")
addresses all three gaps reported above. `make test`: **0 failures**.
`mx check` on this project: **0 errors**.

| Gap reported | Status at `f297447` |
|---|---|
| Finding 17 — `$A / $B` uncaught | **Closed.** MDL045 now fires on `$Dec / $Dec2`. The microflow probe now reports MDL045 ×3, i.e. all three division forms, where `537137b` reported ×2 |
| MDL047 only covered microflow `retrieve` | **Closed.** Now fires on page datasources: "widget `dgProbe` datasource constraint tests association …" |
| MDL-WIDGET15 false positives on heading pairs | **Closed.** Narrowed to "adjacent **inline** dynamictext widgets (RenderMode Text)". `05-pages-foundation.mdl` went from 4 advisories to 0 |

All five `mdlsource/*.mdl` files now pass with no errors and no advisories.

### 29. The MDL-WIDGET15 narrowing treats `Paragraph` as block-level, but Mendix renders it inline

The new advisory ends with:

> …or set a block RenderMode (H1–H6/**Paragraph**).

The `Paragraph` half of that is wrong on Mendix 11.12.1 + Atlas, which has two
consequences: the advice does not fix the problem, and two adjacent
`Paragraph` widgets are no longer flagged even though they still fuse.

Measured directly by rendering a probe page and reading the emitted tag and
computed style:

```
HEAD-ONE   h4    display=block
HEAD-TWO   h4    display=block
PARA-ONE   span  display=inline
PARA-TWO   span  display=inline
```

Rendered output of four widgets — two `Paragraph`, then two default `Text`:

```
PARA-ONEPARA-TWOSPAN-ONESPAN-TWO
```

The checker flags only the `Text` pair. The `Paragraph` pair fuses identically
and is silent.

This retro-explains finding 27: the original Account card used
`rendermode: paragraph` on both widgets and they still ran together — noted at
the time but not understood.

`H1`–`H6` are genuinely block (`<h4>`, `display: block`), so the heading half of
the narrowing is correct and the false-positive fix stands.

**Suggested change:** treat only `H1`–`H6` as block for this rule, and drop
`Paragraph` from the hint text. This project's own
`Account_Overview` is unaffected only by luck — its `Paragraph` footer happens
to follow an `H3`.

---

## Phase 3 — cashflow matrix (2026-07-28)

### 30. `not` needs parentheses

```
if not $IsElapsed then …
  -> line 231:9 extraneous input '$IsElapsed' expecting THEN
```

mxcli's error text explains this one outright, which saved a build cycle:

> Mendix requires parentheses around a negated expression — a bare
> `not <expr>` does not parse: `if not($Cell/IsInvalid) then …` (correct)

### 31. Call-output variables: cannot reuse a declared name, and are scoped to their branch

Two distinct rules, both caught by `mxcli check --references`.

A `call` output variable must be a **new** name — assigning into a variable
that was already declared is CE0111:

```
declare $Through integer = 0;
$Through = call microflow Ledger.CALC_ElapsedThrough ();
  -> duplicate variable name '$Through' — call microflow output variable is
     already declared in this scope (CE0111)
```

**Workaround:** take the call into a fresh name and copy it across:

```
$ThroughCalc = call microflow Ledger.CALC_ElapsedThrough ();
set $Through = $ThroughCalc;
```

And a variable created by a call inside an `if` branch does **not** exist in
the sibling branch:

```
if <variance> then
  $GTotalText = call microflow Ledger.FMT_Variance (…);   -- created here
else
  $GTotalTextB = call microflow Ledger.FMT_Euro (…);
  set $GTotalText = $GTotalTextB;                          -- 'GTotalText' is not declared
end if;
```

**Workaround:** `declare` the target before the `if`, give each branch its own
call output name, and `set` the target in both branches.

### 32. MDL001 nested-loop advisory does not fit aggregation

`DS_CashflowRows` and `DS_ReportContext` walk groups × categories × months to
total figures. MDL001 reads any loop-in-loop as an in-memory key match:

> nested loop detected (loop inside a loop). Use FIND($List, <condition>) for
> in-memory list matching instead of an inner loop (O(N) vs O(N^2)).

`FIND` does not apply — nothing is being looked up by key, every element is
being visited on purpose. Warning-level, so it does not block, but it is noise
on any aggregation microflow.

### 33. `designproperties` are validated per widget type

```
datagrid dgMatrix (designproperties: ['Compact': on, 'Borders': 'Horizontal'])
  -> [MDL-WIDGET11] sets design property "Borders", which is not defined for this widget type
     Valid design properties for this widget: Align self, Hide on, Hover style,
     Row size, Spacing, Style
```

Useful — it lists the valid set rather than just rejecting.

### 34. Dart Sass `rgba()` will not take a comma-list variable

A pattern that worked in older Sass fails the theme build:

```scss
$cf-over: 168, 50, 30;
background-color: rgba($cf-over, 0.1);
```
```
Error: initial build failed: An error occurred while compiling Theme files
  $color: 168, 50, 30 is not a color.
```

**Workaround:** store a real colour and let `rgba()` take the alpha:

```scss
$cf-over: rgb(168, 50, 30);
background-color: rgba($cf-over, 0.1);
```

Worth knowing that a theme compile error fails `mxcli run --local` at the
build step, before the runtime starts — the message is in the run output, not
in `runtime.log`.

### 35. DataGrid2 is the right host for a fixed-width pivot

Recorded as a design confirmation rather than a bug. The analysis (§5.1)
sketched twelve associated cell objects rendered through a nested gallery.
Building it that way would have failed: a gallery sizes its columns per row, so
nothing would line up across rows. DataGrid2 columns are static and therefore
align by construction — which is exactly why the twelve months had to be
attributes on the row (`M01Text`/`M01Band` … `M12Text`/`M12Band`) rather than
associated objects.

`DynamicCellClass` accepts a plain attribute reference, so the heatmap is
`'''cf-cell '' + $currentObject/M01Band'` per column — no expression logic in
the page.

The cost is a 28-attribute non-persistent entity. That is report scaffolding,
not domain data, but it will trip the DESIGN001 lint rule.

### Round 3 — PR #52 at `c5c724b`

`c5c724b` ("MDL-WIDGET15 — Paragraph renders inline, not block (#29)") closes
finding 29. `make test`: **0 failures**. `mx check` on this project: **0 errors**.

The rule now treats `Paragraph` as inline, and the hint says so outright:

> adjacent inline dynamictext widgets (RenderMode **Text or Paragraph, both
> `<span>`**) render with no separator… or use a heading RenderMode (H1–H6,
> which is block-level). **Note: Paragraph does NOT fix this — it also renders
> inline.**

Verified against a four-case probe:

| Case | Widgets | Renders | Flagged |
|---|---|---|---|
| 1 | Paragraph + Paragraph | fuses (measured `<span>`, `display:inline`) | **yes** — was the false negative |
| 2 | H4 + H4 | separate lines (`<h4>`, `display:block`) | no |
| 3 | H3 + Paragraph | separate lines | no |
| 4 | Text + Text | fuses | yes |

Exactly cases 1 and 4 fire; a page containing only cases 2 and 3 passes clean.
That is the correct partition — it matches the tag and computed-style
measurements taken in round 2.

### Regression sweep — no drift across three rounds

Every earlier finding still caught, at the same counts:

| Probe | Expected | Result |
|---|---|---|
| findings 16–21 | MDL044 ×2, MDL045 ×3, MDL046 ×1 | as expected |
| finding 17 (serialization) | MDL045 ×1 | as expected |
| findings 25/26/27 | MDL047, MDL-WIDGET14, MDL-WIDGET15 | as expected |

All nine `mdlsource/*.mdl` pass clean apart from the two known MDL001
false positives on `08-cashflow-datasources.mdl`.

### Still open

**Finding 32** — MDL001's nested-loop advisory still fires on
`DS_CashflowRows` and `DS_ReportContext`, which walk groups × categories ×
months to aggregate. `FIND` does not apply: nothing is looked up by key, every
element is visited deliberately. Warning-level, so it does not block, but it
will fire on any aggregation microflow. The other rules learned to distinguish
their cases (MDL047 by context, MDL-WIDGET15 by render mode); this one has not
yet.

### 36. View entities can carry the matrix aggregation — with one length trap

Investigated whether the display entity behind the cashflow matrix would be
better as a **view entity** (OQL) than a microflow-built non-persistent one.
Answer: yes for the figures, no for the whole thing.

**What works.** A single view does the 12-month pivot, excludes mirrors and
joins the group, in one query:

```sql
create or modify view entity Ledger.VCategoryMonth (
  CategoryName: string(100),
  GroupName: string(50),
  M01Actual: decimal, ...
) as (
  select c.Name as CategoryName, g.Name as GroupName,
    sum(case when t.MonthKey = '2026-01' and t.IsMirror = false then t.Amount else 0 end) as M01Actual,
    ...
  from Ledger.Category as c
  inner join c/Ledger.Category_CategoryGroup/Ledger.CategoryGroup as g
  left join Ledger.Transaction_Category/Ledger.Transaction as t
  group by c.Name, g.Name
);
```

Verified against the seeded data — Groceries Jan €671 / Jul €630, Rent €1,557 /
€1,680 — matching the rendered matrix exactly.

**The win is real.** `DS_CashflowRows` currently issues **~936 retrieves per
render**: 156 category×month pairs for group subtotals, 156 for category rows,
156 for the net line, each pair being `CALC_Actual` + `CALC_Budget`. It computes
the same figures three times. A view collapses that to one query over 13 rows.

**What a view cannot do**, so this stays a hybrid:

- **No `UNION`** — absent from the entire 726-line OQL skill. Group subtotal
  rows, category rows and the net line cannot come from one view.
- **No `ORDER BY`/`LIMIT`** in a view entity (explicit rule) — ordering is the
  UI's job.
- Mode, `€` formatting, band classes and future-month blanking are all
  presentation; a view is a fixed query.

**The trap: pass-through string columns inherit their source length.**
Declaring `CategoryName: string` against a `string(100)` source fails the build:

```
[error] [CE6770] "View Entity is out of sync with the OQL Query." at Entity 'Ledger.VProbeA'
```

Declaring `string(100)` builds clean. Three probes failed this way before the
cause was clear — including one with no `case when` at all, which is what ruled
out type inference.

**Gap in PR #52's MDL031.** The PR added MDL031 for exactly this failure, but
only for *derived* string columns (`cast(...)`, string-returning `case`), which
Mendix normalises to `string(200)`. A **pass-through** column with a mismatched
declared length still passes `mxcli check` and fails at build with the same
cryptic CE6770. Extending MDL031 to compare a pass-through column's declared
length against its source attribute would close it.

**Caveat on the obvious budget query.** Resolving override → baseline as
`max(case when o.MonthKey = '2026-01' then o.Amount else c.BaselineBudget end)`
is wrong in general. It returned correct values here only because all five
seeded overrides happen to exceed their baseline; a *lower* override would lose
to `max`. Correct resolution needs a correlated subquery per month.
