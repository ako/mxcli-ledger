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

**Corrected 2026-07-29.** Two claims in the first version of this finding were
wrong. Both were inferred from the skill doc rather than tested — see 37.

- **`UNION ALL` works.** It parses, builds clean and round-trips through
  `DESCRIBE ENTITY` intact. A single view produced category rows *and* group
  subtotal rows with a computed `SortKey`, multi-hop join chains
  (`c/Ledger.Transaction_Category/Ledger.Transaction`) and conditional
  aggregation. Group subtotals verified against the rendered matrix: Income
  Jan €6,016 / Jul €6,508, Housing €1,858 / €1,961, Daily living €1,047 / €982,
  Lifestyle €464 / €499, Financial €1,019 / €877 — all exact.
- **`ORDER BY` works when paired with `LIMIT`.** mxcli enforces exactly that
  with **MDL030**: "ORDER by without limit: view entity OQL queries that use
  ORDER by must also specify a limit clause". `ORDER BY` alone is rejected at
  check time; `ORDER BY … LIMIT 100` builds clean.

So the mixed row kinds *can* come from one view after all. What genuinely stays
outside the query is only presentation: mode switching, `€` formatting, band
classes and future-month blanking. In practice a view is usually referenced
from another query that applies the ordering, rather than ordering itself.

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

### 37. `write-oql-queries.md` RULE 2 contradicts mxcli's own MDL030

The skill states, as an absolute:

> **RULE 2: NEVER use ORDER BY or LIMIT in VIEW entity OQL**

with both clauses annotated `-- Remove this` in the example. mxcli disagrees —
`MDL030` requires only that `ORDER BY` be *paired* with `LIMIT`:

```
$ mxcli check ...            -- order by, no limit
  ✗ ORDER by without limit: view entity OQL queries that use ORDER by must
    also specify a limit clause [MDL030]

$ mxcli check ...            -- order by ... limit 100
  Check passed!              -- and mx check: 0 errors
```

The rationale in the doc ("let the UI component handle sorting and limits") is
sound guidance, but it is written as a prohibition on a construct the tool
accepts, which is how the wrong claim in finding 36 got made.

`UNION` fares worse: it appears **nowhere** in the 726-line skill, despite
working end to end. Silence in the doc read as absence of support.

**Lesson, and the reason this is filed as a finding rather than a footnote:**
the earlier rounds established that `mxcli check` is a syntax gate and `mx check`
is the authority (finding 22). This adds the mirror of that — the *skill docs*
are not authoritative either. Every capability claim in this file should come
from a probe that was executed, not from a document that was read. Findings 12
and 13 were the same failure mode in the opposite direction: there the docs
claimed something the tool rejected.

**Suggested fixes**, both cheap:
- reword RULE 2 to "ORDER BY requires LIMIT; prefer to let the consuming query
  sort", matching MDL030;
- document `UNION` / `UNION ALL`, which is the construct that makes a
  multi-row-kind report (subtotals + detail + total line) expressible as one
  view.

### 38. `datepart` makes `Transaction.MonthKey` redundant

OQL has `datepart(part, expr)` returning Integer, with comma syntax
(`datepart(YEAR, t.TxDate)` — the SQL-standard `DATEPART(YEAR from ...)` form is
rejected). It works inside a conditional aggregate in a view entity:

```sql
sum(case when datepart(YEAR, t.TxDate) = 2026
          and datepart(MONTH, t.TxDate) = 1
          and t.IsMirror = false then t.Amount else 0 end) as M01Actual
```

Builds clean.

**Design consequence.** `Transaction.MonthKey` (string(7), plus its index) exists
only because the original design assumed the matrix had to group without date
arithmetic — see the comment still in `01-domain-model.mdl`:

> MonthKey is denormalised from TxDate so the matrix can group without date
> arithmetic in every aggregate.

That premise is false. The attribute is derived data with no independent
meaning, it must be written correctly by every producer, and it goes stale the
moment a `TxDate` is edited without it. `datepart` removes the need for it
entirely.

`BudgetOverride.MonthKey` **stays** — there the month *is* the key. There is no
date to derive it from; a budget applies to a month, not to a day.

**Verified consistent.** Across all 334 seeded transactions, zero rows where the
stored `MonthKey` disagrees with `extract(month from TxDate)`, including the 15
that fall on day 1 — and the earliest value is exactly `2026-01-01 00:00:00`,
the most timezone-exposed value in the set.

**Caveat worth carrying:** that clean result is partly environmental — this
container runs UTC. `datepart` against a *localized* DateTime is timezone
sensitive at a midnight boundary, so a date stored as UTC midnight can report
the previous month in a UTC-behind zone. MDL's `date` type appears not to
localize, which is why the boundary held here, but anyone reusing this pattern
on a localized attribute should re-check it rather than assume.

**Secondary benefit:** the pivot stops hardcoding the year twelve times. With
`MonthKey` the branches need literals `'2026-01' … '2026-12'`; with `datepart`
the year appears once per union branch and the month is an integer, so moving
the window to another year is a one-token change.

### 39. Dropping an indexed attribute leaves an orphaned index that crashes `mx check`

Removing `MonthKey` from the entity in `01-domain-model.mdl` and re-applying it
works — and warns clearly, which is good:

```
⚠ create or modify entity Ledger.Transaction drops 1 existing member(s) not
  listed in this statement: MonthKey
```

But the **index that referenced it survives, emptied**:

```
$ ./mxcli -p Ledger.mpr -c "DESCRIBE ENTITY Ledger.Transaction"
  ...
)
index ();
```

and `mx check` then dies rather than reporting a model error:

```
ERROR: System.AggregateException: One or more errors occurred.
  (The given key 'a6cddb2e-265e-4fbd-bfa4-9c3c4b30bfd7' was not present in the dictionary.)
```

That is an unhandled internal exception with no entity name, no error code and
no line — considerably harder to diagnose than the CE errors everything else
produces. The dangling GUID is the dropped attribute, still referenced by the
index.

**No `DROP INDEX` exists.** `mxcli syntax domain-model.entity.alter` lists
`ADD INDEX` but no drop, so the orphan cannot be removed directly.

**Workaround:** declare a *different* index in the same `create or modify`
statement — the index list is replaced wholesale. Here `index (TxDate)` was
wanted anyway, since `CALC_Actual` now filters on a `TxDate` range. `mx check`
returned to 0 errors immediately.

**Suggested fix:** when `create or modify entity` drops an attribute, drop any
index that referenced it, and extend the existing warning to say so. Failing
that, an `ALTER ENTITY … DROP INDEX` would at least make it recoverable.

### 40. The view-entity rebuild, verified identical

`DS_CashflowRows` now reads `VMatrixActual` (19 rows, all three row kinds via
`UNION ALL`) and `VCategoryBudget` (13 rows, overrides resolved), instead of
issuing a retrieve per cell.

**Verified by output equivalence, not by inspection.** Against a dropped and
re-seeded database, all three modes render *identically* to the pre-refactor
matrix — every figure, every heatmap band, every total:

- Actual: KPIs €45,118 / €29,566 / €15,552 / 40 cells; Income Jan €6,016,
  Housing €1,858, Groceries €671, row totals €45,118 / €12,249 / €4,484
- Budget: all five overrides land (Freelance Jul €1,400, Groceries Jul €700,
  Restaurants Jun €320, Transport Jun €340, Shopping May €480); totals
  €73,700 / €21,216 / €12,910
- Aug–Dec still blank in Actual and Variance, populated in Budget

Two details that mattered:

- **Fan-out.** Budgets cannot be joined into `VMatrixActual`: a category with 5
  overrides and 30 transactions yields 150 rows and every actual is multiplied
  by 5. They need their own view.
- **`CE0174`** — "Column 'c.BaselineBudget' cannot both be aggregated and appear
  in the GROUP BY clause". The override resolution
  `baseline + Σoverride − Σ(baseline where overridden)` has to be rewritten as
  `baseline + Σoverride − baseline × Σ(1 where overridden)` so the baseline sits
  outside the aggregate. Same arithmetic, and it avoids the `max(case … else
  baseline end)` form that silently loses a *lower* override.

**Still outstanding:** `DS_ReportContext` computes the four KPIs with its own
category × month loop (~182 retrieves) and has not been moved onto the views.

### Round 4 — PR #52 at `f53e3e9e` (2026-07-29)

Eight new commits since `c5c724b`. `make test`: **0 failures**. `mx check` on
this project: **0 errors**.

**Regression first.** All 19 files in `mdlsource/` pass `mxcli check
--references` under the new binary, and the *fixed* forms this project arrived
at empirically — the materialised `retrieve $Row from $Edit/…` before a call,
the hoisted `set $Acct = …` before a format call — pass clean. No false
positives on a project `mx check` calls valid.

One advisory does fire, correctly: **MDL001** flags the nested loops in
`DS_CashflowRows`, `ACT_ApplyRules` and `CALC_RulePreview`, and its own text
says to ignore it when the inner loop is genuine aggregation rather than a key
lookup. All three here are the former. A hint that names its own false-positive
case is the right shape for this.

**Each fix verified against the construct that produced the finding:**

| # | Finding | Mechanism | Result |
|---|---|---|---|
| 36 | view-entity pass-through string length | reference check | fires, and names the length to use: "change to 'CategoryName: String(100)'" |
| 39 | orphaned index crash | `exec` | index is now auto-dropped with a warning; the .mpr **loads** |
| 41 | association to/from a view entity | reference check | fires, cites CE6771, suggests the NP-with-a-reference workaround |
| 42 | retrieve by id in XPath | MDL048 | fires; correctly notes `[id != $obj]` against an *object* variable stays valid |
| 44 | association path as a call argument | MDL049 | fires, with the materialise-then-pass fix |
| 48 | format function + association navigation | MDL050 | fires, with the hoist-then-format fix |
| 45, 46 | ALTER PAGE limits, DataGrid2 styling | docs | folded into the PR's documentation |

Finding 39 deserves a note: the fix is better than a check. Dropping an indexed
attribute now emits `Dropped 1 index(es) that referenced removed attribute(s)`
and the project still loads — `mx check` reports ordinary CE1613s about the
attribute being gone, which is the true consequence, instead of the
`KeyNotFoundException` in `StreamingBsonUnitReader` that made the .mpr
unopenable and undiagnosable.

**Still open**, all reported after these commits were written:

- **52 — `break` writes a dangling reference.** Still reproduces, and this round
  found a *minimal* case: an eight-line microflow with one loop and one `break`
  is enough to produce an .mpr that `mx check` cannot load. The most severe of
  the open items, because nothing warns and the damage is only visible later.
- **53 — `contains()` is serialized as a List operation.** Confirmed end to end:
  `$Hit = contains($Hay, $Needle);` passes `mxcli check`, then `mx check` gives
  `CE0023` / `CE0097` at "List operation activity 'Contains'". There is no
  spelling of a string `contains()` that works; `find(a, b) >= 0` is the
  workaround.
- **54–57** — empty column caption (CE0463), blank required-attribute message,
  the missing form/layoutgrid advisory, and the reorder refresh.

### Round 5 — PR #52 at `22d9136f` (2026-07-29)

Four new commits, all aimed at findings this project reported open in round 4.
`make test`: **0 failures**. All **22** files in `mdlsource/` pass. `mx check` on
this project: **0 errors**.

| # | Finding | Result |
|---|---|---|
| 53 | `contains()` serialized as a list operation | **Fixed.** `set $Hit = contains($Hay, $Needle);` now builds clean — no CE0023/CE0097 |
| 54 | empty column caption → CE0463 | **Partly fixed** — see below |
| 52 | `break` writes a dangling reference | **Check added (MDL051), defect not fixed** — see below |
| 57 | reorder needs `commit … refresh` | Documented |

**54 is fixed for the case it was not reported against.** The fix fills an empty
caption from the column's bound attribute, and its own note says "a column with
no bound attribute is left untouched". Verified both shapes against the real
project:

| Column | `caption: ''` | `mx check` |
|---|---|---|
| bound to an attribute | filled with the attribute name | **0 errors** |
| custom content, no attribute | left empty | **CE0463**, unchanged |

The originating case was a column of row buttons — custom content, no attribute
— so the shape that produced the finding still fails. A custom-content column
has no attribute to fall back to, so the fix cannot reach it; it needs a
different default, or a check that rejects an empty caption there.

**52 is now caught, but only in one shape, and the hint is wrong about the
other.** MDL051 fires on `break` inside an if/case within a loop, and its text
says:

> (A break placed directly in the loop body serializes fine.)

It does not. A bare `break` in a loop body still produces an unloadable model —
`mx check` dies with `KeyNotFoundException` in `StreamingBsonUnitReader`, the
same crash as before:

```
create or modify microflow Ledger.PROBE_BreakBare ()
…
  loop $C in $Cats
  begin
    set $N = $N + 1;
    break;              -- no conditional; MDL051 does not fire
  end loop;
```

So the check has a false negative on the simpler shape, and its parenthetical
asserts that shape is safe when it is not.

**And `exec` does not enforce the check.** `mxcli-pr52 exec` cheerfully created
the microflow MDL051 rejects. The guard only helps if `check` is run first —
which means the unloadable-.mpr outcome is still reachable by the normal
`exec`-only path. Worth considering whether write-path guards this severe
should be enforced at exec too.

**Still open:** 52 (both the bare-break false negative and the missing exec
enforcement), 54 (custom-content columns), 55, 56, and 63–69 from the dashboard
and styling work — including 67, where MDL silently drops an `action` property
on a pluggable widget, which is the one currently blocking a feature.

**Test-setup note for future rounds.** Copying only `Ledger.mpr` + `mprcontents`
+ `widgets` to a scratch directory yields **950 phantom errors** (CE0535 column
weights and similar) because `theme/` and `themesource/` are missing — design
properties resolve from there. Probing against the real project and dropping the
probes afterwards is more reliable; `git status` confirms it left no trace.

### Round 6 — PR #52 at `19170acc` (2026-07-29)

Eight new commits. All **22** files in `mdlsource/` pass; `mx check` on this
project: **0 errors**.

| # | Finding | Result |
|---|---|---|
| 67 | `action` property dropped on a pluggable widget | **Fixed**, read path included |
| 64 | loop iterator reused across loops | **Now caught at check time** (MDL052) |
| 48 | association navigation in a compound expression | **Root cause fixed; MDL050 correctly withdrawn — but see below** |
| 63 | bare `find()` parsed as a list operation | **Partly fixed** — see below |

**67 verified end to end**, with a core widget so it needs no marketplace module:

```
pluggablewidget 'com.mendix.widget.web.datagrid.Datagrid' dg67 (
  datasource: database Ledger.Category,
  onClick: microflow Ledger.SYNC_RuleCounts
) { column c1 (attribute: Name, caption: 'Category') }
```

```
datagrid dg67 (DataSource: database from Ledger.Category,
               onClick: microflow Ledger.SYNC_RuleCounts) { … }
```

`DESCRIBE` now reads the action back — the write *and* read paths both landed —
and `mx check` is clean. The gap between "validator's key list" and "writer's
propertyMappings" is closed.

**Finding 48 was my misdiagnosis, and the withdrawal of MDL050 is right.** I
recorded it as a *Mendix* rule — "crossing an association has to be the whole
expression". It was an mxcli serialization bug. The rule I wrote into several
file comments was wrong, and those comments have been corrected.

**But the fix does not cover this app's actual case.** Every isolated form I
could build now passes — association navigation in a concatenation, off a
parameter, off a loop variable, split across lines, after a preceding
`call microflow` on the same loop variable. Yet removing the workaround in
`DS_DrillLines` (`09-cashflow-drill.mdl`) reproducibly gives:

```
[error] [CE0117] "Error(s) in expression." at Change variable activity 'Change variable Meta'
```

I could not reduce it below the real microflow within this session, so the
workaround stays in place and the repro is: take `09-cashflow-drill.mdl`,
replace

```
set $Acct = $T/Ledger.Transaction_Account/Name;
set $Meta = formatDateTime($T/TxDate, 'd MMM') + ' · ' + $Acct;
```

with the single-expression form, `exec`, then `mx check`.

**63 is fixed for one use per microflow, not two.** `mxcli check` no longer
false-positives on `set $At = find(…)`, and a single use builds clean. Two uses
in one microflow still collide, because the call is still serialized as a list
operation:

```
[error] [CE0111] "Duplicate variable name 'At'." at List operation activity 'Find by expression'
```

`GET_SunburstPart` calls `find()` twice, so `+ 0` is still required there. Same
underlying issue as 53: the name resolves to the list operation before argument
types are considered.

**A method note.** I twice concluded a fix was complete from an isolated probe,
and twice the real code disproved it — once for 63, once for 48. Both times the
probe was a fair-looking reduction that did not reproduce the surrounding
context. Removing the workaround in place and running `mx check` is the test
that counts; a green probe is not evidence that the workaround can go.

## Phase 4 — budgets (2026-07-29)

### 41. View entities cannot take part in associations — and `mxcli check` says nothing

The natural design for the editable Budgets grid was to reuse `VCategoryBudget`
and hang an association off it back to `Category`, so a saved cell knew what to
write against. Mendix 11.12.1 refuses:

```
[error] [CE6771] "It is not possible to create associations to/from View Entities."
```

Tested **both** directions — `from Ledger.VCategoryBudget to Ledger.Category`
and `from Ledger.Category to Ledger.VCategoryBudget` — and both are rejected.

**The check gap is the finding.** `mxcli check … --references` passed both, and
`mxcli exec` created the association without a murmur; only `mx check` objected.
An association whose end is a view entity is statically impossible, so this is
exactly the class of error `check` should be catching.

**Consequence for the app.** The Budgets grid is built on a non-persistent
`BudgetRow` carrying a real `Category` reference, not on the views. Two small
retrieves, and the edit has something to write against.

### 42. Retrieving by id from a microflow is not expressible in XPath

Given a stored id, the obvious `retrieve … where [id = $Var]` fails:

```
[error] [CE0161] ... invalid XPath constraint
```

— with `$Var` typed as string *and* as Long. `NanoflowCommons` ships
`GetObjectByGuid`/`FindObjectWithGUID` precisely because this is not native.
So the "store the persistent id as a string on the view entity and retrieve by
it" pattern needs a Java action or that marketplace module; it is not something
a microflow can do on its own.

### 43. XPath cannot compare an attribute against an association path

```
retrieve $C from Ledger.BudgetOverride where Ledger.BudgetOverride_Category = $Edit/Ledger.BudgetEdit_Category
```

is rejected: a constraint can compare against an *object variable*, not against
a path walked from one. And a microflow cannot declare an entity variable to
park the path in (MDL043/CE0053). The workaround is to constrain on what XPath
*can* express — here `MonthKey = $Edit/MonthKey`, which is an attribute — and
match the association in memory over the handful of rows that come back.

### 44. A microflow datasource is not invalidated by committing what it reads

`DS_BudgetRows` reads `Category` and `BudgetOverride`. Saving an edit committed
a new `BudgetOverride` — verified in the database, 5 rows to 6 — and the grid
went on showing the old amount. Committing an entity a datasource *reads* does
not mark that datasource stale.

Two ways out, and the second is much better:

1. `close page; show page Ledger.Budgets_Overview;` — re-runs the datasource by
   re-entering the page. Works, but it is a full navigation for one changed cell
   and it rebuilds all thirteen rows.
2. Refresh the **row object** the grid is already showing. The popup carries an
   association back to its `BudgetRow`, so the save rebuilds that one row and
   ends with `change $Row (…) refresh;`. The client re-renders that row in
   place, the popup just closes, and nothing else is touched.

Verified end to end: Rent March € 1,900 → € 2,100, the override marker appears,
the row total moves € 18,180 → € 18,380, the URL stays on `/p/budgets`, and the
popup is gone. Reset, save-equal-to-baseline (which deletes the override rather
than storing a redundant one), and cancel all behave, and the database ends the
run back at the seeded five overrides.

**One wrinkle worth writing down.** `Row = $Edit/Ledger.BudgetEdit_Row` as a
call argument is accepted by `mxcli check` and produces `[error] [CE0117]
"Error(s) in expression."` in `mx check`. An association path is not a value a
call argument can take; it has to be materialised first with an association
retrieve, `retrieve $Row from $Edit/Ledger.BudgetEdit_Row;`. Another check gap.

### 45. Three separate ways `ALTER PAGE` could not rewire a button

The original file order had the save microflows defined *after* the grid page
(they navigated to it), so the popup's buttons had to be bound afterwards. All
three attempts failed, each differently:

1. `set Action = microflow Ledger.ACT_SaveBudget(Edit: $currentObject) on btnSave`
   — parse error. `SET` accepts a fixed property list (caption, class, visible,
   …) and an action is not on it.
2. `replace footEdit with { footer footEdit { … } }` — `failed to build
   replacement widgets: duplicate widget name 'btnSave'`. REPLACE builds the new
   subtree before removing the old one, so a replacement that reuses the widget
   names it is replacing always collides. (It then wrote the change anyway —
   the error was reported after the model had been mutated.)
3. `drop widget footEdit` — `widget "footEdit" not found`. A footer's
   author-given name is discarded on serialization; `DESCRIBE` prints back
   `footer footer1`, and `drop widget footer1` *also* reports not found. The
   footer is not addressable by any name at all. Same family as finding 24
   (`navigationlist` items losing their names), but worse: DESCRIBE emits a name
   that is round-trippable in appearance only.

**Resolution:** stop altering. The save and reset microflows no longer reference
any page, so they now live in `13-budgets-actions.mdl` ahead of the popup, and
the popup binds its buttons directly at creation. The dependency ordering that
made this look necessary — page needs microflow, microflow needs page — was
only ever between *different* microflows.

### 46. DataGrid2's ARIA DOM defeats table CSS, and `Size` is not pixels

Two related surprises when styling the matrix:

- DataGrid2 renders `role="grid"` / `role="row"` / `role="gridcell"` **divs**,
  not `table`/`tr`/`td`. `.ledger-matrix th, td { white-space: nowrap }` matched
  nothing, so every `€ 5,200` broke after the euro sign and the Year column
  ellipsised. Selectors must target the roles.
- `ColumnWidth: manual, Size: 132` is a **flex weight**, not a pixel width.
  Fourteen columns at 132 just divide the available width evenly. Giving the
  matrix room needs `[role='grid'] { min-width: 1320px }` on top of the
  `overflow-x: auto` scroller.

The Playwright tests were affected by the same thing: rows are
`[role="row"]`, not `tr`.

## Phase 5 — cashflow drilldown (2026-07-29)

### 47. `count()` and `sum()` declare their own output variables

Finding 15 was about `create` outputs. Aggregates behave the same way, which is
easy to miss because the natural spelling looks like an assignment:

```
declare $Count integer = 0;
...
set $Count = count($Txs);
```

```
[error] duplicate variable name '$Count' — aggregate list output variable is
        already declared in this scope (CE0111)
```

`$Count = count($Txs);` with no `declare` is the correct form — the aggregate
introduces the name, exactly as `create` and `call microflow` do. Worth knowing
because `declare` + `set` is right for every *other* kind of value, so the
instinct is to write it everywhere.

Credit where due: `mxcli check --references` caught this one before `mx check`
did, with a precise message.

### 48. Crossing an association has to be the whole expression

Hit twice, in different shapes, before the pattern was clear.

Inside a ternary:

```
set $Favourable = if $Cat/Ledger.Category_CategoryGroup/GroupType = Ledger.GroupType.Income
  then $Actual - $Budget
  else $Budget - $Actual;
```

Inside a concatenation:

```
set $Meta = formatDateTime($T/TxDate, 'd MMM') + ' · ' + $T/Ledger.Transaction_Account/Name;
```

Both give:

```
[error] [CE0117] "Error(s) in expression." at Change variable activity 'Change variable …'
```

Hoisting the navigation into its own assignment fixes both:

```
set $IsIncome = $Cat/Ledger.Category_CategoryGroup/GroupType = Ledger.GroupType.Income;
set $Favourable = if $IsIncome then $Actual - $Budget else $Budget - $Actual;

set $Acct = $T/Ledger.Transaction_Account/Name;
set $Meta = formatDateTime($T/TxDate, 'd MMM') + ' · ' + $Acct;
```

**Superseded (round 6).** This was recorded as a Mendix rule. It was not — it
was an mxcli serialization bug, fixed at the root in PR #52, and MDL050 (the
check written against my description) was correctly withdrawn as a false
positive. The paragraph below is left as originally written, because the
reasoning it describes is what the evidence available at the time supported;
treat it as history, not as a rule. Note that the workaround is still needed in
`DS_DrillLines` — see round 6 for the case the fix does not reach.

**The rule, as far as this app had established it:** in a `set` (Change
variable) or a `create` member assignment, a path that *crosses an association*
must be the entire expression. Member access on a parameter is fine anywhere —
`Caption = $Row/Label + ' · ' + $MonthName` works — and so is association
navigation inside an `if` **condition**: this app has
`if ($C/Ledger.Category_CategoryGroup/SortOrder * 100 + $C/SortOrder) = $V/SortKey`
in the matrix builder and it passes. It is specifically an associated value used
as an operand.

`mxcli check --references` passed every one of these: another gap, and the third
of this kind (see 41 and 44).

### 49. No number or date format on a grid column or list

MDL's page grammar has no `format`, `decimalprecision` or equivalent. A Decimal
renders as Mendix's default — `-51.3`, dropping the trailing zero — and a
DateTime in the browser's locale, so a Dutch ledger showed `3/5/2026`.

The workaround is the one CashflowRow already uses for a different reason:
preformat in the builder. The inspector list is a non-persistent `DrillLine`
with `MetaText` and `AmountText` rather than the `Transaction` itself, built by
a datasource microflow over the same retrieve the header figures use.

The cost is real and worth stating: the list no longer holds Transaction
objects, so a future "click a line to edit the transaction" would need the
association back. For a read-only inspector it is the right trade.

### 50. The inspector, verified against the database

Clicking Groceries × March fills the panel with `€ 655 of € 620 budget · 11
transactions`. Straight from Postgres:

```
select count(*), sum(t.amount) ... where c.name = 'Groceries'
  and t.txdate >= '2026-03-01' and t.txdate < '2026-04-01' and t.ismirror = false
   11 | 655.23000000
```

Group subtotals and the net line are not drillable, and this falls out of the
data rather than being a check: `CashflowRow_Category` is only set on category
rows, so the handler finds it empty and declines. 156 drillable cells, 72 not —
13 categories and 6 non-category rows, times twelve months. Clicking a group
cell leaves the panel exactly as it was.

### 51. Where the detail goes changes the model, not just the layout

The drilldown was first built as a popup and then moved beside the matrix, where
the prototype had it. That is not a CSS change.

A popup carries its own object: `ACT_DrillCell` created a `DrillContext`, filled
it, and passed it to `show page`. A panel on the page has nowhere to put one —
a dataview needs a datasource, and there is no second context object to hand it.
So the selection moved onto the page's existing `ReportContext`, the same object
the mode buttons already mutate, and the panel became a plain section of the
page's dataview.

Three things fell out of that, all of them improvements:

- **The panel exists before the first click.** It carries the prototype's own
  empty state — "Select a cell" / "Click any cell in the matrix to list the
  transactions behind it." — instead of the feature being invisible until
  discovered.
- **The selected cell can be outlined.** `ACT_DrillCell` ends with
  `change $Context (…) refresh;`, and because the matrix datasource takes that
  context as its parameter, Mendix re-runs it. The builder reads the selection
  back off the context and appends `cf-sel` to the band string, so the class
  lands on the grid cell rather than the container inside it. This is the same
  refresh mechanism as the mode buttons — and, from the other direction, the
  same one the Budgets grid needed in finding 44.
- **A cell click needs two objects, and a page can pass one.** `$currentObject`
  in a grid cell is the `CashflowRow`; the ReportContext is not addressable from
  there. Rather than rely on Mendix's by-type parameter mapping, the builder —
  which holds both — writes a `CashflowRow_Context` association, and the handler
  retrieves it. Deterministic, and it costs one reference per row.

The cost is width: the matrix gives up a quarter of the page, so 9 of 12 months
are visible at 1600px instead of all 12 (934px of a 1442px grid). The prototype
had the same shape with 6 months. The legend under the matrix now says so — it
is also from the prototype, and it explains the heatmap while it is there.

## Phase 6 — rules engine (2026-07-29)

### 52. `break` inside a loop writes a dangling reference

`ACT_ApplyRules` is a nested loop with `break` on first match — the whole point
of a first-match-wins engine. `mxcli check --references` passed; `mx check` did
not load the project at all:

```
ERROR: System.AggregateException: One or more errors occurred.
 (The given key '0299365f-d79b-4487-bd0d-4930ee045b47' was not present in the dictionary.)
   at Mendix.Modeler.Storage.Operations.StreamingBsonUnitReader.ResolvePostponedProperties()
```

Same failure mode as finding 39 (the orphaned index): not an error message about
the model, but the loader falling over on a reference to something that was
never written. Locating it needed a byte scan of `mprcontents/` for the GUID —
it appeared in exactly one unit, `CALC_RulePreview`, one of the two microflows
using `break`.

**Workaround:** a guard variable.

```
set $Caught = false;
loop $R in $Rules
begin
  if not($Caught) then
    …
    set $Caught = true;
  end if;
end loop;
```

Uglier and it keeps iterating, but the lists here are 8 rules × 12 transactions.
Both `break` uses removed; `mx check` loaded the project immediately.

**Suggested fix:** `break` (and presumably `continue`, untested) needs to emit
the sequence flow to the loop's exit. Until then it should be rejected by
`mxcli check` rather than silently producing an unloadable .mpr.

### 53. `contains()` is serialized as a LIST operation, so string contains is unavailable

The rules engine needs a substring test. `contains($Haystack, $Needle)` is a
Mendix string function, and it is what any Mendix developer would write.

`mxcli check --references` refused it first:

```
duplicate variable name '$Match' — list operation output variable is already
declared in this scope (CE0111)
```

Working around *that* — assigning to an undeclared name — hit a parse error,
because the form expects a variable as the first argument:

```
$InList = contains(',' + $Needle + ',', ',' + $Hay + ',');
                   ^ mismatched input '','' expecting VARIABLE
```

Hoisting both sides into variables got it past mxcli, and then `mx check`
explained what had really happened:

```
[error] [CE0023] "Selected variable 'Needle' must be of type Object or List." at List operation activity 'Contains'
[error] [CE0097] "The selected 'Hay' variable must be of type List."          at List operation activity 'Contains'
```

mxcli parses `contains(a, b)` as the **list** operation `Contains` — the one
that asks whether a list holds an object — not as the string function. There is
no spelling of a string `contains()` that survives.

**Workaround:** `find($Hay, $Needle) >= 0`, which serializes as an ordinary
expression and means the same thing.

### 54. An empty column caption reports as a changed widget definition

A grid column of row buttons wants no header. `caption: ''` produced:

```
[error] [CE0463] "The definition of this widget has changed. Update this widget
        by right-clicking it and selecting 'Update widget'…" at Data grid 2 'dgRules'
```

which points at the widget version, not at the caption, and suggests a fix that
has nothing to do with the cause. Found by bisecting the page: dropping the
column cleared it, dropping the nested dataview in a *different* column did not,
and setting `caption: 'Actions'` cleared it with the column intact.

### 55. A required attribute with no error message blocks the page that would fix it

`MatchValue: string(200) not null` on CategoryRule. A new rule is created empty
and filled in on the edit page — but clicking 'New rule' popped a modal reading

```
MatchValue has an issue:
```

with nothing after the colon, and the edit page never opened. The required
validation has no message because `not null` was written without one, so the
dialog has nothing to say, and it fires before the user can reach the field it
is complaining about.

Dropped the `not null` and moved the check into the save microflow, where it can
say something useful ("Give the rule something to match on."). mxcli's own lint
rule MPR004 covers exactly this — an empty validation message, CE0091 — so it
would have been caught by `mxcli lint` had that been run before the UI.

### 56. Form fields need a layoutgrid, and nothing says so

The rule editor's labels rendered truncated — 'Operator' as 'Opera…', 'Value' as
'Val…' — with the fields dropped straight into the dataview:

```
dataview dvRule (datasource: $Rule) {
  combobox cbRuleField (label: 'Field', attribute: RuleField)
  combobox cbRuleOperator (label: 'Operator', attribute: RuleOperator)
  ...
}
```

The cause is the missing layoutgrid: the label column has no grid to size
against. Wrapping the fields in `layoutgrid / row / column` renders them
properly. `FormOrientation: Vertical` also hides the symptom, by removing the
label column entirely — which is why it looked like a fix and was not.

A half measure is still wrong: with two fields sharing a row at
`desktopwidth: 6`, the label takes three twelfths of *that column*, and
'Operator' truncates again. In a popup this narrow, one field per full-width
row is what works.

Neither `mxcli check` nor `mx check` says anything. The page is valid; it just
looks broken once it runs, which is the worst kind of defect to find in a
headless workflow.

**Suggested fix:** an advisory lint rule — input widgets with labels directly
under a dataview, with no layoutgrid between, should be flagged. It is a
mechanical check over the widget tree and would have caught this before the
first screenshot.

### 57. A reorder commits but the grid keeps the old order

`ACT_MoveRuleUp` swaps SortOrder between two rules and commits both. The engine
picked up the new order immediately — a re-run categorised the transaction
through the *promoted* rule — while the grid went on displaying the old numbers
against the new counts, which reads as the engine ignoring the order.

`commit $Rule refresh;` on both sides fixes it. Worth noting because the grid is
a **database** datasource, not the microflow datasource of finding 44: a plain
commit refreshes a row's *values*, but re-sorting the list needs the explicit
refresh.

The trap is that the wrong-looking screen is the correct engine. Believing the
grid here would have meant "fixing" a rules engine that was already right.

### 58. What the engine actually does

Semantics, all verified against the running app:

- Rules run in `SortOrder`, first match wins.
- Only transactions with **no** category are considered, so a rule never
  overwrites a hand-assigned category.
- Matching is case-insensitive and trimmed. `is one of` wraps both sides in
  commas so `Netflix` matches `Spotify,Netflix,iCloud` and `Net` does not.
- `MatchCount` is **derived**, recomputed from `Transaction_CategoryRule` after
  every run rather than incremented. An in-place counter drifts the first time
  anything is reset, re-run, or deleted.
- The `CategorisedByRule` boolean is gone. It recorded *that* a rule fired, not
  which one, so two rules pointing at Groceries could never be told apart. The
  association carries the same fact and more. This also removed a lie in the
  seed, which set `CategorisedByRule = true` on transactions the generator had
  categorised.

## Phase 7 — matching the prototype's design system (2026-07-29)

### 59. Atlas' tokens are the whole job; the widgets never needed touching

The app looked like stock Atlas. Bringing it to the prototype — warm paper, flat
hair-ruled cards, dark sidebar, IBM Plex, mono figures — took two files and no
widget changes:

- `theme/web/custom-variables.scss`, where Atlas exposes ~150 CSS custom
  properties: `--bg-color`, `--border-color-default`, `--border-radius-s`,
  `--font-family-base`, `--navsidebar-bg`, `--grid-bg-header`, the lot. Setting
  those moved the entire app at once, and every control kept its own states,
  focus rings and dark-mode handling because nothing was overridden at the
  component level.
- `themesource/ledger/web/main.scss` for the handful of things Atlas has no
  token for: monospace figures, a serif page title, the segmented mode switch.

Worth stating because the instinct is to reach for the component CSS first. The
token layer is both smaller and more durable.

### 60. The webfont hook, and why the fonts are not committed

Atlas self-hosts Poppins from `/resources/fonts/…` and exposes
`$font-family-import` for anything else. The prototype uses IBM Plex, so:

```
$font-family-import: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans…';
```

Self-hosting Plex the way Atlas hosts Poppins would mean committing six font
binaries, which this project does not do. The trade is a runtime CDN dependency,
so every stack has a real fallback (`system-ui` for sans, `ui-monospace` for
mono, Georgia for serif) and the app degrades to system faces rather than
breaking.

**Verified** the `@import` reaches `theme-cache/web/theme.compiled.css`. It does
*not* load in this container's headless Chromium, which has no direct network —
the screenshots here are the fallback stacks. Pointing Playwright at the agent
proxy (`--proxy-server`) is how to see the real thing.

### 61. Two Atlas shell defaults that fight a dense app

- **The sidebar collapses to 48px** and clips every label to
  'Cashflo…'. That is why the app grew an in-page menu card on every screen in
  the first place. `--navsidebar-width-closed: 224px` — equal to the open width
  — pins it open, which let all five menu cards be deleted and gave the
  twelve-month matrix back a quarter of the page.
- **Navigation rows are sized for a 48px icon slot** even with no glyphs, so
  the rows are mostly empty space. `--navsidebar-icon-height: 0` plus explicit
  padding brings them to the prototype's density.

One thing that could not be reproduced: Atlas' navigation tree puts no `active`
class on the current page's item, so the prototype's left-rail highlight on the
selected screen has no hook to hang on without JavaScript.

### 62. `::before` and `::after` bracket the children, not the element

The sidebar wordmark is drawn on the navigation container, since Atlas has no
slot for one. Putting the wordmark in `::before` and the 'Household finances'
kicker in `::after` puts the kicker *below the last menu item* — the two pseudo
elements bracket the element's children, and the children are the whole menu.
The kicker has to hang off the inner wrapper's `::before` instead. Obvious in
hindsight, invisible until rendered.

## Phase 8 — dashboard sunburst (2026-07-29)

### 63. `find()` is a list operation too, unless it is part of a larger expression

Finding 53 was about `contains()`. `find()` behaves the same way, but with a
twist that makes it easy to miss:

```
declare $At integer = 0;
set $At = find($Raw, '"id":"');        -- CE0111 duplicate variable name '$At'
                                       -- "list operation output variable"
```

Yet this, from the rules engine, is fine:

```
set $Match = find($Hay, $Needle) >= 0;
```

The difference is whether the call is the **entire** right-hand side. Alone it
is parsed as the list operation `Find`; inside any binary expression it stays
the string function. So the workaround for wanting the index itself is to make
the expression non-bare:

```
set $At = find($Raw, '"id":"') + 0;
```

`+ 0` is not a no-op to the parser, which is the whole point — and is why the
line carries a comment in `21-dashboard-builder.mdl`. Same root cause as 53:
mxcli resolves these names to list operations before considering the argument
types.

### 64. A loop variable is scoped to the microflow, not to its loop

Three sequential loops over the same list, each with `loop $R in $Rows`, is the
natural way to write a three-pass rollup. Mendix rejects it:

```
[error] [CE0111] "Duplicate variable name 'R'." at Loop
[error] [CE0111] "Duplicate variable name 'S'." at Loop
```

Loop iterators share one flat namespace with everything else in the microflow,
so every loop in a microflow needs its own iterator name — `$G`, `$C`, `$M`
here. `mxcli check --references` passes it; `mx check` catches it. Another
member of the gap family in findings 41, 44 and 48.

**A caution earned the hard way:** the obvious fix — bulk-renaming `$R` to `$G`
in one block — also rewrites `$Rows`, and renaming `$S` rewrites `$Sub` and
`$Sep`. That produced a microflow referring to `$Mows` and 24 fresh errors.
Renames of MDL variables need word boundaries, or a rewrite of the whole flow.

### 65. The multi-level donut needed no custom widget

The obvious reading of "multi-level donut" is that Mendix has no such chart and
one has to be built. It does have one. `Charts.mpk` was already in this
project, and its **CustomChart** ("any chart") widget takes raw Plotly `data`
and `layout` JSON — and Plotly's `sunburst` trace *is* a multi-level donut.

Three properties make it work, none of which the MDL shorthand widgets expose,
so the page uses the `pluggablewidget '<id>' name (…)` escape hatch:

| Property | Purpose |
|---|---|
| `dataAttribute` | String attribute holding the Plotly `data` array |
| `layoutAttribute` | String attribute holding `layout` |
| `eventDataAttribute` | String attribute the widget **writes** the clicked point into |

`eventDataAttribute` + `onClick` is the drilldown hook, and it is what makes a
custom widget unnecessary: the widget hands back the whole Plotly point object,
so encoding the hierarchy path into each node's `id` (`M:Housing|Rent|Woonstad`)
means one `find`/`substring` pass recovers which ring was clicked and what to
filter by. A microflow has no JSON reader; designing the id so that plain string
functions are enough avoids needing one.

**The hollow centre is a consequence, not a setting.** Plotly's sunburst has no
`hole` attribute. Emitting the four category groups as *roots* (parent `""`)
rather than under a single synthetic root leaves the middle empty, which is
exactly the donut look.

### 66. MDL-WIDGET10 caught a property that would have been silently ignored

The chart was authored with `OverflowY: auto` alongside `maxHeightUnit: none`:

> ⚠ page Ledger.Dashboard: widget `chartSunburst` (customchart) property
> `OverflowY` is hidden when `maxHeightUnit` is "none" — the value will be
> ignored [MDL-WIDGET10]

Correct, and the sort of thing that is invisible otherwise: the app builds, the
property is simply dropped. This is the widget-property equivalent of the
dynamic hide-rules Studio Pro applies in its editor, and it is new in PR #52.

### 67. MDL silently drops an `action` property on a pluggable widget

The dashboard needs `onClick` on CustomChart. MDL accepts it:

```
pluggablewidget 'com.mendix.widget.web.customchart.CustomChart' chartSunburst (
  dataAttribute: ChartData,
  eventDataAttribute: EventData,
  onClick: microflow Ledger.ACT_SunburstClick(Context: $currentObject),
  …)
```

`mxcli check --references` passes. `mxcli exec` reports "Created page". `mx check`
reports 0 errors. The app builds and runs. And `DESCRIBE PAGE` shows the widget
with **every property except `onClick`**:

```
pluggablewidget 'com.mendix.widget.web.customchart.CustomChart' chartSunburst (
  dataAttribute: ChartData,
  configurationOptions: …, widthUnit: percentage, width: 100,
  heightUnit: pixels, height: 520, … , eventDataAttribute: EventData
)
```

Tested both `onClick: microflow M(args)` and `onClick: microflow M` — neither
survives. The BSON writer is not the problem: `sdk/mpr/writer_widgets_custom.go`
serializes `{Key: "Action", Value: serializeClientAction(val.Action)}` on a
WidgetValue, so the gap is upstream, where MDL properties are turned into widget
values.

**Why this one matters more than the earlier gaps.** The others produced an
error somewhere — `mx check` caught them, or the .mpr failed to load. This
produces a working app with a dead control. Nothing anywhere says the property
was ignored.

**Root cause, traced on request (2026-07-29).** Not a missing action slot —
CustomChart declares `<property key="onClick" type="action">` and
`mxcli widget describe` prints it. The loss happens in the **generated def**:
`customchart.def.json` carries 18 `propertyMappings` against 22 described
properties, and `onClick` is not among them. Across all 42 defs in this project
the only operations emitted are `primitive`, `texttemplate`, `attribute`,
`datasource` and `selection` — there is no `action` operation at all, and
**24 of 24** widgets that declare an action property and have a def lose it.

Why MDL-WIDGET01 stays quiet: it is reading a different list. In one widget,
`bogusPropertyThatDoesNotExist: 42` is rejected while `onClick:` is not — so the
validator's known-key list includes `onClick` (it comes from the widget
definition, which knows about actions) while the writer works from
`propertyMappings`, which does not. Anything in that gap validates and writes
nothing.

**Reproducible without any marketplace module:** `Data grid 2` ships with every
project and declares `onClick`, `onSelectionChange` and `onConfigurationChange`.
Evidence pack, including the generated def and a minimal repro, is in
[`docs/finding-67/`](./docs/finding-67/).

### 68. Writing a widget attribute does not re-run a datasource over its object

With `onClick` unreachable, the fallback was to derive the panel from
`eventDataAttribute` instead: the widget writes the attribute, the object
changes, and the microflow datasources parameterised on it re-run.

They do not. Verified end to end — the widget does write the attribute on every
click (its code takes that branch whenever `eventDataAttribute` is configured),
and the two datasources over the same object never re-ran.

Consistent with finding 44 from the other direction: a microflow datasource is
invalidated by an explicit `refresh`, not by an attribute changing.

### 69. CustomChart's event data is a bounding box, not the clicked point

Even with `onClick` wired, this widget could not drive this drilldown. Its
handler is:

```js
eventDataAttribute
  ? eventDataAttribute.setValue(JSON.stringify(points[0].bbox))
  : executeAction(onClick)
```

`points[0].bbox` — the segment's screen rectangle. Not `id`, `label` or `value`.
The Plotly event itself carries all of those (confirmed in the browser: a click
on the Albert Heijn segment yields
`{id: "M:Daily living|Groceries|Albert Heijn", label: "Albert Heijn", value: 1123.56}`),
but the widget discards them.

So the id-encoding scheme in `21-dashboard-builder.mdl` is correct and useless
with this widget: the information exists in the browser and never reaches the
microflow. A pluggable widget that forwarded `points[0].id` — or simply the
whole point — would make the whole feature work as designed.

## Phase 9 — runtime observability (2026-08-04)

Monitoring the running app with `--metrics` and `--trace-otlp`, per the
`analyze-runtime` skill. The full report is in
[`docs/observability.md`](docs/observability.md); the two mxcli defects are here.

### 70. `--trace-otlp` reports success when the OTel agent failed to start

The skill says user-set `OTEL_*` environment wins over what mxcli sets, so I set
`OTEL_EXPORTER_OTLP_PROTOCOL=http/json` to make the spans easy to parse:

```bash
OTEL_EXPORTER_OTLP_PROTOCOL=http/json mxcli run --local --ensure-db \
  --metrics --trace-otlp http://127.0.0.1:4318 --trace-service ledger
```

mxcli reported:

```
Metrics (Prometheus): http://127.0.0.1:8090/prometheus
Tracing enabled (OpenTelemetry, service "ledger"); spans -> OTLP http://127.0.0.1:4318
Preview available at https://ledger-demo.mxcli.org
```

The app started and served normally. No spans ever arrived. The reason was only
in `runtime.log`:

```
OpenTelemetry Javaagent failed to start
io.opentelemetry.sdk.autoconfigure.spi.ConfigurationException: Unsupported OTLP traces protocol: http/json
	at io.opentelemetry.exporter.otlp.internal.OtlpSpanExporterProvider.createExporter(OtlpSpanExporterProvider.java:80)
```

The bundled agent (2.28.1) ships only the protobuf exporter. Two things went
wrong independently: the agent aborted, and mxcli announced tracing was on
anyway. The second is the one that costs time — the observable symptom is an
empty span file, which reads as "my collector is misconfigured" rather than "the
agent is dead". A boot-time check for `Javaagent failed to start` in the runtime
log, surfaced as a warning, would have made this immediate.

Removing the variable and letting the default (`http/protobuf`) stand fixed it —
14,396 spans in one browsing pass.

### 71. Documented metric names are not the ones served

`analyze-runtime.md` gives:

```bash
curl -s http://127.0.0.1:8090/prometheus | grep -E 'connectionbus_|handler_requests|sessions_|taskqueue_'
```

and names the families `connectionbus_{selects,inserts,updates,deletes,transactions}_total`.
The runtime actually serves them under an `mx_runtime_stats_` prefix:

```
mx_runtime_stats_connectionbus_selects_total{XASId="a547a678-..."} 2269.0
mx_runtime_stats_handler_requests_total{XASId="a547a678-...",name="xas/"} 45.0
mx_runtime_stats_sessions_anonymous_sessions 1.0
```

The skill's own `grep` still matches (it is unanchored), so this only bites when
you anchor the pattern or script against the documented name — which is what a
sampler does. Worth correcting in the skill, since the surrounding text presents
those as the family names.

Two related traps for anyone scripting against this endpoint, neither an mxcli
bug but both worth writing down:

- `jvm_memory_used_bytes` has an `id` label containing spaces
  (`id="G1 Eden Space"`), so the value is `$NF`, not `$2`. Summing `$2` yields
  zero silently.
- `handler_requests_total` is per-handler (`name="xas/"`, `name="p/"`, …), so
  there is no single total to read.

### 72. MDL001's `find()` advice is right, and the syntax is not in the skills

Fixing the N+1 datasources (docs/observability.md) left two nested loops that
were key lookups rather than aggregation. `mxcli check` flagged both:

```
⚠ nested loop detected (loop inside a loop). If the inner loop is a key LOOKUP
  (finding one matching item), replace it with FIND($List, <condition>) for an
  in-memory match (O(N) vs O(N^2)). [MDL001]
    at Ledger.DS_CashflowRows
    → For a lookup: $Match = FIND($List, key = $item/key).
```

The advice is correct and the distinction it draws — lookup versus genuine
aggregation — is the right one: the same file's budget rollup is a real
group × category × month aggregation and the rule says to ignore it there.
Both lookups converted cleanly:

```
$Cat = find($Cats, Name = $V/Label);
if $Cat != empty then
  change $Row (Ledger.CashflowRow_Category = $Cat);
end if;
```

`mxcli check --references` passed and `mx check` reported 0 errors.

Two notes for anyone following the same hint:

- **`find($List, <condition>)` appears nowhere in `.ai-context/skills/`.**
  `HELP list operations` returns "No syntax help found". The only statement of
  the syntax is the lint message itself. It is also easy to conflate with the
  string `find()` of FINDINGS 33, which returns an index and must not be
  declared — a different function with the same name.
- It assigns an entity-typed variable without a `declare`, which is the only
  way to hold one at all (MDL043/CE0053 forbids declaring entity locals). That
  makes `find()` more than an optimisation: it is the idiomatic way to carry a
  looked-up object out of a loop.

### 73. Removing an N+1 bought less than expected, and the trace said why

Worth recording because the measurement contradicted the obvious prediction.
`DS_CashflowRows` went from 173 database queries per render to 4, and got only
about 60 ms faster (median 270 ms → 209 ms).

The spans explain it: against a loopback Postgres each of those queries cost
~0.4 ms, so 169 of them were ~68 ms of a ~270 ms flow. The remaining cost is
interpreter overhead — the flow makes roughly 3,000 nested microflow calls per
render (`GET_ViewBudget` alone runs 468 times) and 1,611 Change activities.

The lesson is not that the fix was pointless — 169 round trips against a
database 1.5 ms away is ~250 ms, and it is per concurrent user — but that
*query count and wall-clock time are separate problems*, and only the trace
distinguishes them. A lint rule counting retrieves inside loops would have
flagged this flow correctly and still mispredicted the payoff by 4x.

### 74. A casted id is a usable key; `[id = $Var]` is not

A view entity cannot carry an association (CE6771, finding 41), which had left
two builders matching view rows back to objects by display name. The question
was whether an object id could be exposed instead. Three probes, in order.

**`select c.id as CategoryId` is read as an association, not an id.** It
applies without complaint and then fails validation:

```
[error] [CE1613] "The selected association 'Ledger.CategoryId' no longer exists."
        at OQL query 'Ledger.VProbeId'
```

**`cast(c.id as string)` works, and must be declared `string(200)`.** At
`string(50)` it is CE6770 "View Entity is out of sync with the OQL Query" — a
derived column normalises to 200 regardless of the source (finding 36).

**There is no way back to the object.** `retrieve … where id = $Text` is
rejected by MDL048, which is precise about why and about the alternative:

```
✗ retrieve '$Cat' constrains the object id against a value ([id = $IdText]),
  which Mendix XPath does not support (CE0161) — there is no id operator
  reachable from a microflow expression                              [MDL048]
  → Retrieve by GUID with a marketplace action (NanoflowCommons GetObjectByGuid
    / CommunityCommons), or expose the id as a String on a view entity
    (cast(id as string) as ObjectId) and constrain on that String column.
```

That second suggestion is the whole trick, and it was worth verifying rather
than assuming, because it only helps if ids agree across separately defined
views. They do. Two independent probe views, one over Category and one over
Transaction joined to Category, and the id-constrained fetch against the
ordinary association join:

```
VProbeCat  → Groceries = 5066549580792692
SELECT CatId, count(*), sum(Amount) FROM VProbeTx WHERE CatId = '5066549580792692'
  → 77 rows, -4484.06
SELECT ... FROM Transaction t INNER JOIN t/Transaction_Category/Category c
  WHERE c.Name = 'Groceries' AND t.IsMirror = false
  → 77 rows, -4484.06
```

Same rows, and −4,484 is the Groceries figure both screens display.

So the rule is: **a casted id is a real key between view entities, and never a
route to a persistent object.** Both drilldowns were rebuilt on it — the
cashflow inspector no longer retrieves all thirteen categories to name-match
one, and the sunburst's node ids are `G:<groupId>` / `C:<groupId>|<categoryId>`
instead of concatenated names. Two associations (`CashflowRow_Category`,
`ReportContext_DrillCategory`) were dropped outright.

What it does *not* replace: an association between two persistent entities.
There you would lose referential integrity, delete behaviour, and XPath
navigation from either side, and gain nothing — the object is already reachable.
Both associations dropped here were on non-persistent display objects that live
for one render.

### 75. Dynamic Text formatting is a Mendix feature MDL cannot reach — and asking for it inline is dropped in silence

The [Text widget reference](https://docs.mendix.com/refguide/text/) gives the
widget three General properties — **Caption**, **Parameters** and **Render
Mode** — plus Visibility, Common and Design Properties. Each entry under
Parameters has three settings:

> **Index** – identification number of a parameter
> **Value** – an attribute or expression value to be displayed
> **Format** – a format in which the value will be displayed (only for attributes)

MDL covers all of that except the last word of it. `content` is Caption,
`rendermode` is Render Mode, `class` and bracket-expression visibility cover the
styling and Visibility sections, and `contentparams: [{1} = Attr]` carries a
parameter's **Index** and **Value**.

**There is no slot for `Format`.** The round trip of a decimal-bound Text is
complete at:

```
dynamictext txtPlain (Content: '{1}', ContentParams: [{1} = SignedAmount])
```

One property, and it is the one that decides whether a number is readable.

That is the whole reason this app preformats. `DrillLine.AmountText`,
`CashflowRow.M01Text` and every other display string exist because a Decimal
rendered through `dynamictext` comes out as `-51.3` and `5068.38000000`. It is
also the direct cause of the README's "Transactions screen shows raw decimals"
gap, and it is what stopped the cashflow inspector becoming a plain
database-datasource list over a view entity: OQL cannot build `#,##0.00`
either — it has no `substring`, no `abs` and no `floor` (CE0174) — so the one
column that must stay in a microflow keeps the whole list in one.

**The worse half is how the attempt fails.** Setting the property inline on a
`create or replace page` is accepted everywhere and then discarded:

```bash
$ mxcli check probe.mdl -p Ledger.mpr --references
✓ All references valid
Check passed!
$ mxcli exec probe.mdl -p Ledger.mpr
Created page Ledger.ProbeFmt2                      # no warning
$ mxcli -p Ledger.mpr -c "DESCRIBE PAGE Ledger.ProbeFmt2"
dynamictext txtFmt (Content: '{1}', ContentParams: [{1} = SignedAmount])
```

`decimalprecision: 2, groupdigits: true` went in and are simply not there. No
error, no warning, `mx check` 0 errors — the same silent-drop class as finding
67, and the same reason it costs time: the model is quietly not what the source
says.

The `ALTER PAGE` path, by contrast, fails properly:

```
Error: failed to set: failed to set DecimalPrecision on txtPlain:
       property "DecimalPrecision" not found (widget has no pluggable Object)
```

So the unknown-property check exists and works on one path and not the other.

Two asks for mxcli, in order:

1. **Give `contentparams` a `Format` slot**, so a parameter can carry the third
   setting the reference documents alongside Index and Value — something like
   `contentparams: [{1} = SignedAmount format '#,##0.00']`. It is one property
   on one widget, and it removes an entire class of workaround: every
   preformatted string entity in this app exists only because of its absence.
2. **Reject an unknown widget property on the inline page path**, the way
   `ALTER PAGE SET` already does. Whatever the answer to (1), silently
   discarding an authored property is the more expensive bug — the model is not
   what the source says, and nothing tells you.

### 76. mxcli PR #88 tested — the format block is written correctly and has no runtime effect *(FIXED, verified)*

PR #88 (`feat(pages): dynamic-text parameter formatting via a FORMAT block`)
answers finding 75 with a per-parameter `format (…)` block and a new
MDL-WIDGET18 for the silent drop. Both halves do what they claim, and the
feature still does not reach the screen.

**What works.** The widget-level key now errors instead of vanishing:

```
✗ page Ledger.T1: widget `d1`: `decimalprecision` is a per-parameter format, not a
  widget property … A widget-level `decimalprecision` is dropped on write. [MDL-WIDGET18]
```

The block parses, applies, survives `mx check` (0 errors) and round-trips —
`decimalPrecision: 2` is omitted on read because it is the default, while `0`
and `4` come back verbatim:

```
dynamictext dT3 (Content: '{1}', ContentParams: [{1} = SignedAmount format (groupDigits: true)])
precision 0 -> format (decimalPrecision: 0, groupDigits: true)
precision 4 -> format (decimalPrecision: 4, groupDigits: true)
```

The `Forms$FormattingInfo` written into the `.mpr` is complete and correct.

**What does not.** Converting the Transactions grid's date and amount to
custom-content columns with `format (dateFormat: Custom, customDateFormat:
'd MMM yyyy')` and `format (decimalPrecision: 2, groupDigits: true)`, then
rebuilding from an emptied `deployment/`, still renders:

```
7/4/2026, 12:00 AM   Pluk Bloemen   iDEAL 20000   -12
```

Not `4 Jul 2026` and `-12.00`. The custom content is live — 32 `.tx-date` and 32
`.tx-amount` containers in the DOM — so the columns are mine; the formatting is
simply ignored.

**Root cause, from the serialized parameter.** `Forms$ClientTemplateParameter`
comes out as:

```json
{ "$Type": "Forms$ClientTemplateParameter",
  "Expression": "toString($currentObject/TxDate)",
  "FormattingInfo": { "$Type": "Forms$FormattingInfo",
                      "DateFormat": "Custom", "CustomDateFormat": "d MMM yyyy",
                      "DecimalPrecision": 2, "GroupDigits": false },
  "AttributeRef": null }
```

`FormattingInfo` is right. `AttributeRef` is **null**, and the value is an
*expression*: `toString($currentObject/TxDate)`. The Text reference says Format
is "a format in which the value will be displayed (**only for attributes**)" —
so an expression parameter is exactly the case the runtime does not format. And
`toString()` has already stringified the value before formatting could apply,
which is why a Decimal reads `-12` rather than `-12.00` even at the default
precision.

This is not specific to the new syntax: **all 248 template parameters in that
page have `AttributeRef: null`**. MDL has always written `{1} = Attr` as an
expression rather than an attribute reference, which is why every screen in this
app preformats.

So PR #88 needs one more piece: when a content parameter is a plain attribute,
serialize it as `AttributeRef` instead of `Expression: toString(...)`. The
`FormattingInfo` half is already correct and will start working the moment the
parameter is an attribute.

**Fixed and verified.** PR #88 gained
`fix(pages): bind non-String dynamic-text params as AttributeRef so formatting
applies`. Retested by converting the Transactions grid's date and amount to
custom-content columns and rebuilding from an emptied `deployment/`:

```
before   7/4/2026, 12:00 AM   -12      -21.4     -1556.96   5308.52
after    4 Jul 2026           -12.00   -21.40    -1,556.96  5,308.52
```

Decimal precision, group digits and the custom date pattern all apply.
`AttributeRef` is non-null on 10 of 254 parameters — the non-String ones — where
it was null on all 254 before. `mx check`: 0 errors.

Two smaller things from the same test run:

- ~~The PR does not build as pushed.~~ **Wrong, mine.** A bare
  `go build ./cmd/mxcli` fails with `paCtx.ParamFormatV3 undefined` after a
  grammar change, but `mdl/grammar/parser/` is gitignored and the project's own
  target is `build: grammar sync-all completions` — regenerating is a normal
  build step, not something the PR omitted. Use `make build`.
- **MDL-WIDGET18's suggested fix does not parse.** It advises
  `ContentParams: [{1} = Attr (decimalprecision: <value>)]`, omitting the
  `format` keyword the PR's own documentation calls required. Copy-pasting the
  suggestion gives a syntax error; `{1} = Attr format (…)` is correct.

### 77. Data Grid 2's Dynamic Text column type is missing from MDL — and asking for it corrupts the grid *(FIXED, verified)*

Following 76: if a content parameter's formatting is going to work, the next
question is how to reach it from a grid column, since that is where the raw
decimals actually show. The [Data Grid 2 reference](https://docs.mendix.com/appstore/modules/data-grid-2/)
gives a column **three** content types:

> 1. **Attribute** — renders the value of a selected attribute
> 2. **Dynamic Text** — renders a text-templated string which can contain text combined with attributes
> 3. **Custom Content** — allows dropping widgets into cells

and documents no formatting options on the Attribute type. So **Dynamic Text is
the intended mechanism**: it is a text template, its parameters are
`ClientTemplateParameter`s, and those are what carry `FormattingInfo`.

MDL exposes the first and third. `column colX (attribute: Amount)` is Attribute;
`column colX (caption: '…') { widgets }` is Custom Content. There is no syntax
for the middle one.

Worse, the obvious spelling parses and then destroys the column:

```sql
column colA (caption: 'Amount', content: '{1}',
             contentparams: [{1} = SignedAmount format (decimalPrecision: 2, groupDigits: true)])
```

```
$ mxcli check t-col.mdl -p Ledger.mpr
Check passed!
$ mxcli exec t-col.mdl -p Ledger.mpr
Created page Ledger.TCol
$ mxcli -p Ledger.mpr -c "DESCRIBE PAGE Ledger.TCol"
      column Amount (Caption: 'Amount')
```

`content`, `contentparams` and the format block are all gone; the column has
even lost its name, taking the caption instead. And unlike the other silent
drops, this one leaves a model that does not load:

```
[error] [CE0463] "The definition of this widget has changed. Update this widget by
        right-clicking it and selecting 'Update widget' …" at Data grid 2 'dg1'
The app contains: 1 errors.
```

So `mxcli check` passes, `mxcli exec` succeeds, and the project is broken — the
worst ordering of the three.

**The ask:** expose Dynamic Text as a column content type, carrying the same
per-parameter `format (…)` block PR #88 added to `dynamictext`. That is the
route to formatted grid columns without wrapping every cell in Custom Content,
and it is what the reference points at.

Note it does not stand alone: finding 76 must land too. A Dynamic Text column
whose parameter is written as `Expression: toString($currentObject/Attr)` with
`AttributeRef: null` will be ignored by the runtime exactly as the widget one
is. The two together are what make a formatted grid column work.

**Retested after PR #88's AttributeRef fix — unchanged.** 76's half now works,
but a column still swallows `content`/`contentparams`, still renames itself to
its caption, and still leaves `CE0463` behind:

```
$ mxcli check t-col.mdl -p Ledger.mpr        # Check passed!
$ mxcli exec  t-col.mdl -p Ledger.mpr        # Created page Ledger.TCol
$ mxcli -p Ledger.mpr -c "DESCRIBE PAGE Ledger.TCol"
      column Amount (Caption: 'Amount')
$ mx check Ledger.mpr
[error] [CE0463] "The definition of this widget has changed …" at Data grid 2 'dg1'
```

Custom Content is the working route today: wrapping the cell in a container with
a formatted `dynamictext` renders correctly (verified above on the Transactions
grid). Dynamic Text would be lighter, and is what the reference points at, but
Custom Content is not blocked on it.

**Fixed and verified.** PR #88 gained `fix(pages): DataGrid2 dynamic-text
columns — carry FORMAT block + fix CE0463`. The content type is explicit —
`ShowContentAs: dynamicText` — which is why my first retest still failed: I had
omitted it, and a column without it is still an attribute column.

```sql
column colAmt2 (ShowContentAs: dynamicText, caption: 'Amount', Alignment: right,
  Content: '{1}', ContentParams: [{1} = SignedAmount format (decimalPrecision: 2, groupDigits: true)])
```

Round-trips complete (`ShowContentAs`, `Content`, `ContentParams` and the format
suffix all come back), raw `mx check` is 0 errors, and the page renders:

```
DATE          MERCHANT                 AMOUNT
12 Jan 2026   Koelewijn Holding BV     5,308.52
2 Feb 2026    Koelewijn Holding BV     5,622.69
```

No custom-content wrapper, no page errors. This is the lighter route the Data
Grid 2 reference points at, and it now works.

Two notes from the fix worth keeping:

- **`mxcli docker check` masks this class of defect.** It runs `mx update-widgets`
  first, which repairs the very BSON discrepancy that produces CE0463. Raw
  `~/.mxcli/mxbuild/*/modeler/mx check` and the `run --local` serve build surface
  it. Every check in this file used the raw binary, which is why it was caught.
- **Column names still do not round-trip.** `colAmt2` comes back as
  `column Amount`, taking its caption. Long-standing rather than new, and
  independent of the formatting work — written up separately as finding 78.

### 78. A grid column's authored name is discarded, and the handle it gets instead is neither stable nor unique

Every other widget in MDL is addressable by the name you give it. Columns are
not: the authored name is dropped on write and replaced by a derived one. Four
columns, one of each kind:

```sql
column colAuthoredAttr   (attribute: Merchant, caption: 'Who')
column colAuthoredDyn    (ShowContentAs: dynamicText, caption: 'When', …)
column colAuthoredCustom (caption: 'Actions') { actionbutton btnN (…) }
column colNoCaption      (attribute: Description)
```

come back as:

```
column Merchant
column "When"
column "Actions"
column "Description"
```

Not one authored name survives. The rule is **attribute name for an attribute
column, caption for everything else** — note `colAuthoredAttr` becomes
`Merchant`, its attribute, *not* `Who`, its caption.

**The authored name cannot address the column; the derived one can:**

```
ON colAuthoredAttr  → Error: widget "colAuthoredAttr" not found
ON Merchant         → Altered page Ledger.NTest
ON "When"           → Altered page Ledger.NTest
ON When             → Error: widget "When" not found     (quoting is not optional)
```

That alone is a round-trip wart. Two further behaviours make it a hazard.

**The handle moves when the caption does.** For a non-attribute column the
handle *is* the caption, so renaming the caption silently renames the column:

```
set Caption = 'Renamed' ON "When"   → Altered
… the column is now `column Renamed`, and:
set Caption = 'Again'   ON "When"   → Error: widget "When" not found
```

An attribute column is immune — its handle is the attribute — so the same
edit is stable in one case and self-destructing in the other, with nothing in
the syntax to distinguish them. A script that renames captions in sequence
works or breaks depending on a column kind the author never had to think about.

**Duplicate captions produce duplicate handles, and the ALTER hits the first
one silently.** Two dynamic-text columns captioned 'Amount':

```
column Amount        ← Alignment: right applied here
column Amount        ← untouched, and unaddressable
```

`set Alignment = right ON "Amount"` reports `Altered page`, changes only the
first, and gives no indication the second exists. There is no way to reach it.

`mx check` is 0 errors throughout — the model is valid. This is purely an MDL
addressability defect, and it is why `ALTER PAGE … ON colM03` failed when I
tried to probe the cashflow matrix's cell classes (finding 76): the name in the
source had never existed in the model.

**Ask:** persist the authored column name and address columns by it, as every
other widget already is. Failing that, two smaller improvements would remove
most of the sting — reject an `ON <name>` that matches more than one column
rather than silently taking the first, and error on the authored name instead
of reporting "not found" for a name that is right there in the source.

### 79. `mxcli theme apply` over an existing hand-built theme half-applies, with no warning

mxcli now ships three themes, one of them called **ledger** — "warm paper,
hairline rules instead of cards, serif headings" — which is this app's design
language, and it vendors its faces (`theme/web/mxcli-fonts/`, Source Sans 3 +
Source Serif 4, SIL OFL) rather than importing them from a CDN. That is exactly
the fix this project's README lists as an open gap.

Applying it here does not deliver it. `mxcli theme apply ledger` reports eleven
files written and exits 0:

```
  added     theme/web/custom-variables.scss
  added     theme/web/main.scss
  created   theme/web/mxcli-fonts/…            (7 woff2 + OFL.txt)
```

`added`, not `replaced` — the generated block is inserted *alongside* this
project's own 35 `--ledger-*` tokens in the same file. The result is neither
theme:

- The page ground shifts slightly (`rgb(246,244,240)` → `rgb(247,244,238)`) —
  so it is not a no-op.
- Every font stays the project's (`"IBM Plex Mono", ui-monospace…`), because
  `themesource/ledger/web/main.scss` is a *module* stylesheet and compiles after
  `theme/web/`. The theme's own `main.scss` comment says it "compiles last, so
  the partials win" — true within `theme/`, not against a themesource module.
- **The Google Fonts request still fires and still fails.** The seven vendored
  woff2 files are downloaded, written, and never referenced.

So the one thing worth having — no CDN at runtime — is precisely what does not
arrive, and nothing says so. `apply` could reasonably notice that
`custom-variables.scss` already carries non-generated declarations, or that a
themesource module defines a competing `main.scss`, and warn.

Adopting the shipped theme properly is a real option for this app, but it is a
design decision rather than a drop-in: it means deleting this project's palette,
and it would cost the monospace figures — mxcli's themes vendor a sans and a
serif, no mono, and this app's whole numeric layout rests on tabular monospace
(see the README's note on why). `mxcli theme remove` plus restoring
`theme/` from git returned the app exactly to its prior state.

### 80. `mxcli test --local` runs against an unseeded database, and a failed assertion does not say what it got

The new local test runner is fast and the mechanism is a good one — one boot,
a token-guarded endpoint, each test its own microflow invoked over HTTP. Seven
tests run in 573 ms. Two things cost time on the way to that.

**It replaces AfterStartupMicroflow, so nothing seeds.** The run announces it:

```
After-startup set to MxTest.RegisterEndpoint (registers the endpoint; runs no tests)
```

which reads as plumbing, not as "your app's initialisation will not run". This
app seeds its demo data from `Ledger.ASU_Startup`, so every query in every test
saw an empty database. The first assertion failed with no hint why; the
hypothesis was only confirmed by asserting the *empty* answer and watching it
pass:

```
@expect $ctx/SubText = '€ 0 in · € 0 out · € 0 kept'      → PASS
```

A test that needs data has to seed for itself — `$x = call microflow
Ledger.Seed_DemoData ();` as the first statement of the block. Worth saying in
the runner's output, since replacing the after-startup microflow is invisible
in its consequences.

**A failing assertion prints the expectation but not the actual value.**

```
FAIL  Sankey balances income against spend and surplus (158ms)
       expected $ctx/SubText = '€ 45,118 in · € 29,566 out · € 15,552 kept'
```

There is no "got …" line, so a mismatch gives you nothing to work from — the
only way forward is to guess a value and assert it. Every other assertion
library prints both sides; this one has the value in hand at the point it
decides to fail.

**`@expect` does take expressions**, which is not obvious from the help (it
shows only `@expect $result = 'John Doe'`). `contains(…) = true` works, and so
does a bare boolean conjunction:

```
@expect contains($ctx/ChartData, '"source":[') and contains($ctx/ChartData, '"value":[')
```

That is what made data-independent assertions possible here, and it deserves a
line in the help text.

**A note on what to assert, which is this project's mistake rather than
mxcli's.** The first version of these tests pinned exact euro totals. They
failed against the test database, and the reason was not a bug: `Seed_DemoData`
generates transactions up to the current date, so a database seeded today holds
more than one seeded ten days ago — 380 rows against 334, measured. Euro
figures are a property of *when* the database was seeded. The suite now asserts
the palette and the payload's shape, and the figures are verified against
Postgres instead.

---

## Phase 10 — a Studio Pro round-trip (2026-08-09)

The app had been authored entirely through mxcli up to this point. Commit
`b1856a7` is the first change made in Studio Pro: widgets updated to current
Marketplace versions, and icons added to the six navigation menu items. Both
halves broke on the way back.

### 81. Navigation menu-item icons are invisible to MDL, and the documented round-trip deletes them *(FIXED for collection icons, verified)*

> **Fixed upstream, 2026-08-13.** mxcli gained `MENU ITEM … PAGE … ICON
> Module.Collection.Name`, and `DESCRIBE NAVIGATION` now emits it. The fix and
> its remaining edge are recorded at the end of this entry; the original
> diagnosis is left intact because the mechanism it identified has *not*
> changed — items are still deleted and recreated, and the grammar's coverage
> is still what decides what survives.

Six menu items carried icons, deliberately spanning all three kinds Mendix
supports:

| Menu item | `$Type` | Value |
|---|---|---|
| Dashboard | `Forms$IconCollectionIcon` | `Atlas_Core.Atlas.align-center` |
| Cashflow | `Forms$IconCollectionIcon` | `Atlas_Core.Atlas.align-bottom` |
| Budgets | `Forms$IconCollectionIcon` | `Atlas_Core.Atlas_Filled.alert-circle` |
| Transactions | `Forms$IconCollectionIcon` | `Atlas_Core.Atlas_Styling.aligncontent-horizontal-space-between` |
| Accounts | `Forms$GlyphIcon` | code `9999` |
| Categories & rules | `Forms$ImageIcon` | `System.Images.Close` |

`DESCRIBE` emits none of them:

```
$ mxcli -p Ledger.mpr -c "DESCRIBE NAVIGATION Responsive"
create or replace navigation Responsive
  home page Ledger.Dashboard
  menu (
    menu item 'Dashboard' page Ledger.Dashboard;
    menu item 'Cashflow' page Ledger.Cashflow_Overview;
    ...
  )
;
```

The write side cannot express them either — `mxcli syntax navigation.create`
gives the whole menu-item grammar as `MENU ITEM 'Label' PAGE Module.Page;`,
with no icon clause.

**The two combine into silent data loss.** `mxcli syntax navigation` documents
the round-trip as the way to change navigation:

```
navigation.alter    Modify navigation via round-trip: DESCRIBE, edit, CREATE OR REPLACE
```

Feeding `DESCRIBE`'s own output straight back is therefore the sanctioned
workflow, and it destroys every icon. Verified on a copy of the project rather
than the real one — apply the block above, then read the icons back out of the
navigation unit's BSON:

```
== BEFORE (as committed)
   'Dashboard'              Forms$IconCollectionIcon Atlas_Core.Atlas.align-center
   'Cashflow'               Forms$IconCollectionIcon Atlas_Core.Atlas.align-bottom
   'Budgets'                Forms$IconCollectionIcon Atlas_Core.Atlas_Filled.alert-circle
   'Transactions'           Forms$IconCollectionIcon Atlas_Core.Atlas_Styling.aligncontent-…
   'Accounts'               Forms$GlyphIcon 9999
   'Categories & rules'     Forms$ImageIcon System.Images.Close
== AFTER  (mdl re-applied)
   'Dashboard'              (none)
   'Cashflow'               (none)
   'Budgets'                (none)
   'Transactions'           (none)
   'Accounts'               (none)
   'Categories & rules'     (none)
```

mxcli reported success: `Navigation profile 'Responsive' updated.` No warning,
no error, and `mx check` stays at the same error count — nothing anywhere says
six properties were dropped.

**This is not the engine failing to preserve unmentioned values.** Preserving
them is the modelsdk engine's whole reason for existing over the legacy one, and
it works here — it is the navigation writer that steps outside it. Object
identity shows exactly where the line falls. Comparing `$ID`s before and after
the same write:

```
          doc                profile            menu (MenuItemCollection)
baseline  ab8629b6c91e845c   2f04a03860481953   8d18a1bf43fe1c4f
modelsdk  ab8629b6c91e845c   2f04a03860481953   4eb4bcdcdf288c42   ← new
legacy    ab8629b6c91e845c   2f04a03860481953   cc71a503eac2df43   ← new
```

The document and the profile keep their identity, so they are *updated in
place* and everything the statement did not mention survives on them — which is
why `AppIcon` and `AppTitle` come through untouched despite `DESCRIBE` omitting
both:

```
BEFORE  AppIcon='Atlas_Core.Content.Mendix'  AppTitle='Mendix'
AFTER   AppIcon='Atlas_Core.Content.Mendix'  AppTitle='Mendix'
```

The `MenuItemCollection` gets a **new** id, and so does every one of the six
items inside it (`ca489fb1…` → `88d0e47a…`, and so on for all six). They are not
updated and stripped — they are deleted and rebuilt from the parse tree. There
is no unmentioned value left to preserve because the object that held it no
longer exists. The preservation contract never gets a chance to apply.

**Both engines do this identically**, so it is not a legacy-versus-modelsdk
difference and not a regression in the new engine — the menu writer is shared
and opts out of the model in both. (Measured on throwaway copies; this project
never authors with `--engine legacy`.)

That changes what the fix is. Adding icon syntax to the grammar and to
`DESCRIBE` is worth doing on its own, but it would only close *this* hole —
every other menu-item property MDL does not model would keep vanishing the same
way. The structural fix is for the writer to reconcile the collection instead of
replacing it: match incoming items to existing ones, mutate those in place, and
create or delete only the difference. Then menu items inherit the same guarantee
the profile already has, and the grammar's coverage stops being the thing that
decides what survives.

**How it was fixed (2026-08-13).** The grammar route, as expected — and the
part worth praising is what it does with the cases it *cannot* carry.
`DESCRIBE NAVIGATION` now emits:

```
    menu item 'Dashboard' page Ledger.Dashboard icon Atlas_Core.Atlas."align-center";
    …
    menu item 'Accounts' page Ledger.Account_Overview;
    -- icon a numeric glyph code (Forms$GlyphIcon) is not reproducible by CREATE NAVIGATION; set it in Studio Pro
    menu item 'Categories & rules' page Ledger.Category_Overview;
    -- icon System.Images.Close (Forms$ImageIcon) is not reproducible by CREATE NAVIGATION; set it in Studio Pro
```

`ICON` covers `Forms$IconCollectionIcon` only, so two of this app's six — a
glyph icon and an image icon — still cannot be authored. But the loss is no
longer silent, which was the actual defect: the round-trip now states what it
is about to drop, in the output you are about to re-apply, at the exact line
where the information used to disappear. **A tool that cannot represent
something and says so is in a completely different class from one that
represents it as nothing.** More surfaces should do this.

Verified by applying the emitted MDL to a copy and reading the icons back:
the four collection icons round-trip exactly; the glyph and image icons come
back absent, as advertised. Menu item ids still change on every write, so the
delete-and-recreate mechanism above is unchanged — the grammar now simply
covers the common case.

The app authors all six as collection icons (`22-dashboard-page.mdl`). The two
that could not round-trip were placeholders — glyph code 9999 and a generic
close cross — so they became `credit-card` and `tag-group`, which both mean
something and keep the file set reproducible. That trade is only free because
they were placeholders; an app whose glyph icons were deliberate would have to
choose between reproducibility and its icons, and should know that before it
re-applies.

**Consequence for this project.** `mdlsource/22-dashboard-page.mdl` owns the
navigation block, and this app's stated method is to re-apply all 24 files from
scratch rather than patch. That normal build now silently reverts the icons, so
file 22 carries a warning comment until MDL can round-trip them.

### 82. Widget packages are gitignored, so a widget update makes every other clone unbuildable

`.gitignore:14` is `*.mpk`, added by this project in `0ccf6db` on a "do not
commit binaries" reading. Mendix's own convention commits `widgets/`, and this
is why.

Studio Pro updated the Marketplace widgets and rewrote the stored instances to
match. The instances are inside `Ledger.mpr` and travelled with the commit; the
packages they now describe did not. A fresh clone gets the new model against
whatever `.mpk` happen to be on disk:

```
$ ~/.mxcli/mxbuild/11.13.0/modeler/mx check Ledger.mpr
[error] [CE0463] "The definition of this widget has changed. …" at Data grid 2 'dataGrid2_1'
The app contains: 116 errors.

$ ~/.mxcli/mxbuild/11.13.0/modeler/mxbuild Ledger.mpr
BUILD FAILED
```

Errors by module — 73 of them are in Atlas page templates the app never uses,
but ten are ours and any one is enough to fail the build:

```
     73 Atlas_Web_Content
     11 Administration
     10 MyFirstModule
     10 Ledger
      9 Atlas_Core
      3 FeedbackModule
```

The ten in `Ledger` are six Data Grid 2s (`dgMatrix`, `dgBudgets`,
`dgTransactions`, `dgNeedsReview`, `dgCategories`, `dgRules`), three Combo boxes
on `CategoryRule_Edit`, and `galAccounts`. The Dashboard is clean — CustomChart
is unaffected, so the sunburst and sankey still hold.

What is installed against what the commit declares:

| Package | on disk | declared |
|---|---|---|
| Image | 1.5.0 | 1.6.0 |
| Combo box | 2.5.0 | 2.9.0 |
| Charts | 6.2.1 | 6.3.2 |
| Maps | 4.0.0 | 4.1.0 |
| Timeline · Badge · Progress Bar | 3.2.2 | 3.2.3 |
| Progress Circle | 3.3.2 | 3.3.3 |
| Data Widgets *(module)* | 3.5.0 | 3.11.3 |
| Atlas Core *(module)* | 4.1.3 | 4.3.8 |

The declared column comes from `Ledger/widgets/widgets-appstore-metadata.json`,
new in this commit — Studio Pro now records the version and content GUID of each
Marketplace widget. That file is the recovery key, and it is worth noting that it
covers only *widgets*: Data Grid 2 and Gallery ship inside the Data Widgets
**module** and appear nowhere in it, even though six of Ledger's ten errors are
theirs. Their version has to be read from `themesource/datawidgets/.version`.

**Two commands look like the fix and are not.**

`mxcli widget sync` reconciles instances against the packages that are
installed, so with stale packages it runs backwards — it would strip the new
Data Grid 2 selection and dynamic-pagination properties to match 3.4.0:

```
$ mxcli widget sync -p Ledger.mpr --dry-run
  dgTransactions  (Datagrid 3.4.0)
    - allSelectedText          not declared by Datagrid 3.4.0
    - dynamicPageSize          not declared by Datagrid 3.4.0
    - enableSelectAll          not declared by Datagrid 3.4.0
    …
65 widget instance(s), 746 property change(s) across 31 container(s).
```

That is a real capability pointed the wrong way: it is for when the packages are
ahead of the model, and here the model is ahead of the packages. Its own help is
straight about the limits (`PARTIAL — clears 7 of 40 CE0463 on the reference
fixture`) and about the alternative, `mx update-widgets`, which "destroys the
mprcontents/ folder on MPR v2 projects".

`mxcli marketplace download` is the right route but needs a Personal Access
Token; without one it stops before any network call:

```
$ mxcli marketplace search "Charts"
auth: no credential for profile "default". Run: mxcli auth login --profile default
```

`mxcli auth login` is a browser flow this container cannot complete, but the
token is read from `MENDIX_PAT` directly, so supplying the variable is enough.
Confirmed by injecting a dummy value and watching the failure move from "no
credential" to a real 401 from `marketplace-api.mendix.com` — the env-var path
and the outbound proxy both work.

**The fix is to stop ignoring `*.mpk` and commit `Ledger/widgets/`** (9.6 MB).
Packages are as much a part of a Mendix app's source as the `.mpr`; leaving them
out produces a repository that only builds on the machine that authored it, and
nothing warns you until a widget version moves.

---

## Phase 11 — custom charting (2026-08-13)

A custom pluggable widget rendering Vega-Lite, and the first chart through it:
the cashflow matrix as a small-multiple sparkline grid. Three of these four are
about getting a widget of one's own into an MDL-authored project; the first is
about what happened when the same numbers were drawn more densely.

### 83. Elapsed is not the same as reported — the matrix was printing € 0 for a month it had no data for

Not an mxcli finding. An app defect, recorded because of *how* it was found:
it had been shipping in plain sight and the denser rendering made it obvious in
one glance.

`CALC_ElapsedThrough` answers a calendar question — which months have happened —
and the matrix used it to decide which cells to fill. But a month can be elapsed
and hold nothing: bank data arrives in arrears, and this app's seed stops at the
previous month end. The current month therefore had a full budget, a zero
actual, and was rendered as a real figure:

```
CATEGORY   JAN      …   JUL      AUG    SEP  OCT
Salary     € 5,309  …   € 5,541  € 0
Rent       € 1,557  …   € 1,680  € 0
```

Every row read `€ 0` for August, heat-shaded as wildly under budget, while
September and October were correctly blank. This is exactly the misreading that
blanking future months exists to prevent (PROTOTYPE-ANALYSIS §5.3) — the app
had the principle written down and the boundary in the wrong place.

It also cost the over-budget KPI. The income test is
`budget - actual > budget * 0.02`, so a zero actual is always a miss: both
income categories contributed a phantom over-budget cell (`5200 > 104`,
`900 > 18`). The expense test, `actual - budget > budget * 0.02`, is false at
zero — so the count was inflated by exactly two. It reads 40 now.

**A table hid it; a chart could not.** `€ 0` in a narrow column is easy to skim
past, and this one had been skimmed past for weeks. The same value as a line is
a plunge to the axis in all thirteen panels at once, and it was the first thing
visible on the first render. Denser encoding is not only prettier — it has less
room to hide a wrong number in.

The fix is a second window, `CALC_ReportingThrough`: the earlier of months
elapsed and months with any activity. Only the trailing edge moves, so a
category that genuinely booked nothing in March still shows its zero, because
some other category has a March transaction. It takes the already-retrieved
`VMatrixActual` list as a parameter rather than retrieving again — MDL list
parameters (`$Rows: list of Ledger.VMatrixActual`) work fine and are the right
tool on a datasource path.

The totals never moved: € 45,118 income before and after, because adding a zero
month changes a sum but not by anything.

### 84. `ALTER PAGE … INSERT` has no idempotent form, which a re-appliable source set needs

Every other statement this project writes is `create or modify` or
`create or replace`, which is what makes `mdlsource/` re-appliable — the stated
method is to rebuild from scratch rather than patch. `ALTER PAGE` breaks that
pattern:

```
$ mxcli exec mdlsource/23-cashflow-sparklines.mdl -p Ledger.mpr
Replaced microflow: Ledger.DS_SparklineData
Error: failed to insert: duplicate widget name 'lgSparkRow': a widget with this name already exists on the page
```

There is no `INSERT … IF NOT EXISTS`, and no `DROP WIDGET … IF EXISTS` to pair
with it, so the file cannot make itself safe to re-run. Note also that the
statements before the failure had already been applied — the script is not
atomic, so a re-run leaves the model half-updated.

In the canonical flow it is survivable: file 11 recreates the page from scratch
before file 23 inserts into it, so applying the whole set in order works. But
iterating on one file — the normal way anyone develops — does not, and the
workaround is a manual `DROP WIDGET` between runs. Either guard would fix it,
and `DROP WIDGET … IF EXISTS` is the smaller change.

### 85. A module package is not authoritative for the widgets it bundles

Worth knowing before running `marketplace install` on a module.

Restoring the widget packages (finding 82) went 116 errors → 2, both remaining
ones on Atlas_Core's native phone layouts, using Feedback 3.4.0 where Atlas Core
4.3.8 ships 3.6.1. Taking the widgets out of the Atlas Core package looked like
the obvious fix and made things much worse:

```
$ unzip -o -j AtlasCore-4.3.8.mpk 'widgets/*.mpk' -d widgets/
$ mx check Ledger.mpr
The app contains: 78 errors.
```

Atlas Core bundles its own copies of Image and Combo box — at **1.5.0** and
**2.6.1**, against the **1.6.0** and **2.9.0** the model was authored against
and that `widgets-appstore-metadata.json` pins. A module ships whatever versions
it was built against, which for a widely-depended-on module like Atlas Core is
often behind the standalone package.

So a module package is a source of *a* version, not *the* version. Take only
the widgets that are actually missing:

```
$ unzip -o -j AtlasCore-4.3.8.mpk 'widgets/com.mendix.widget.native.Feedback.mpk' -d widgets/
$ mxcli marketplace install 118579 --version 1.6.0 -p Ledger.mpr   # Image
$ mxcli marketplace install 219304 --version 2.9.0 -p Ledger.mpr   # Combo box
$ mx check Ledger.mpr
The app contains: 0 errors.
```

`mxcli marketplace install` is type-aware and got this right on its own for the
eight standalone widgets — it copies a widget into `widgets/` and, for a module
already present, refuses and reports rather than overwriting. The trap is only
in reaching into a module package by hand, which is still necessary for Data
Grid 2 and Gallery because they have no standalone listing.

### 86. Authoring a pluggable widget for an MDL-driven project works, with two snags

The path is short and none of it needs Studio Pro. A hand-written widget project
(`package.json`, `src/package.xml`, `src/VegaChart.xml`, one `.tsx`),
`pluggable-widgets-tools build:web`, and the `.mpk` lands in the project's
`widgets/` folder by way of `config.projectPath`. Then:

```
$ mxcli widget extract --mpk widgets/ledger.widget.web.VegaChart.mpk
  Widget ID:  ledger.widget.web.vegachart.VegaChart
  MDL name:   VEGACHART
  Properties: 6
  Output:     .mxcli/widgets/vegachart.def.json
```

and the widget is placeable from MDL like any built-in, with every property
carried through — including a multi-line string property holding a 60-line JSON
spec, which is what makes a spec-as-data widget authorable this way at all.
`mx check` is clean and the widget renders.

Two things cost time:

**`mxcli widget extract` needs `--mpk`, and its error does not say so.** Passing
the file positionally — which is what the command's own shape suggests — prints
a full usage dump ending in `required flag(s) "mpk" not set`, with the
positional argument silently ignored.

**Mendix's base tsconfig cannot resolve modern package types.**
`@mendix/pluggable-widgets-tools` 11.12.1 sets `moduleResolution: "node"`,
which predates the `exports` field. vega-embed 7 publishes its types only
through `exports`, so the build fails with `TS2307: Cannot find module
'vega-embed'` even though Rollup resolves and bundles the package correctly.
One override in the project's own tsconfig fixes it:

```json
{ "compilerOptions": { "moduleResolution": "bundler" } }
```

Worth flagging because the failure names the module, not the resolution mode,
and the obvious readings — package missing, types missing, wrong version — are
all wrong. The base config also sets `jsx: "react-jsx"`, so the
`import { createElement }` that Mendix widget examples still open with is now an
unused import and `noUnusedLocals` fails the build on it.

### 87. The widget definition cache is gitignored and does not refresh when a package changes

Found while verifying that finding 81's fix had made the source set re-appliable
again. It had — but the re-apply exposed something else.

Applying all 25 `mdlsource/` files to a copy of the working project produced a
model that failed `mx check`, where the project itself was clean:

```
The app contains: 6 errors.
      1 at Data grid 2 'dgBudgets'
      1 at Data grid 2 'dgCategories'
      1 at Data grid 2 'dgMatrix'
      1 at Data grid 2 'dgNeedsReview'
      1 at Data grid 2 'dgRules'
      1 at Data grid 2 'dgTransactions'
```

Every MDL-authored Data Grid 2, and only those — CE0463 again, from the other
direction this time. Finding 82 was stale *packages* against a current model.
This is a current package against a stale *schema*: mxcli writes a widget
instance from `.mxcli/widgets/<name>.def.json`, extracted from whichever `.mpk`
was installed when it was first written. Data Grid 2 had since moved 3.4.0 →
3.11.3, so every grid mxcli wrote described a widget that no longer exists.

Nothing warns. The authoring pass succeeds, `mxcli check` passes, and the model
is broken in a way only `mx check` reports — which is the same shape as several
earlier findings and the reason this project treats `mx check` as the authority.

`mxcli widget init` is the refresh, and it detects the drift on its own once
asked:

```
$ mxcli widget init -p Ledger.mpr
  ~ pluggable    DATAGRID             com.mendix.widget.web.datagrid.Datagrid
Extracted: 0 new, 3 refreshed, 31 up to date, 9 skipped (built-in or unparseable)
```

Re-applying the four page files afterwards took it back to 0 errors.

**The cache is gitignored** — `Ledger/.gitignore:31` is `.mxcli/` — which is the
right call, since it is derived from the packages. But that makes it a build
input that no clone starts with and nothing regenerates automatically, so the
documented build recipe was incomplete. Verified against a true fresh-clone
simulation — copy the project, delete `.mxcli/`, then:

```
$ mxcli widget init -p Ledger.mpr
$ for f in mdlsource/*.mdl; do mxcli exec "$f" -p Ledger.mpr; done
all 25 files applied cleanly
$ mx check Ledger.mpr
The app contains: 0 errors.
```

`widget init` now leads the recipe in the README. The general rule is worth
stating plainly: **after any widget package changes, refresh the definitions
before authoring anything that uses them.** Upgrading a package silently
invalidates every stored instance mxcli would write next.

---

## Phase 12 — six charts on a grammar (2026-08-13)

An Insights page: stream graph, scatter, calendar heatmap, standing costs,
year-over-year, and a miscategorisation view. Six charts, five datasets, four
queries. What they cost was mostly not what was expected.

### 88. OQL will not aggregate one `datepart` of a column while grouping by another

A merchant that bills in most months is a subscription, so "how many distinct
months did this merchant appear in" is the whole recurrence signal. The natural
query is one row per merchant-year carrying that count:

```sql
select t.Merchant, datepart(YEAR, t.TxDate) as Yr,
       count(distinct datepart(MONTH, t.TxDate)) as MonthsActive
from Ledger.Transaction as t
group by t.Merchant, datepart(YEAR, t.TxDate)
```

```
[error] [CE0174] "Error(s) in OQL query: Column 't.TxDate' cannot both be
        aggregated and appear in the GROUP BY clause." at Entity 'Ledger.VMerchantYear'
```

`datepart(YEAR, t.TxDate)` in the GROUP BY makes `t.TxDate` a grouped column, and
`datepart(MONTH, t.TxDate)` inside an aggregate makes it an aggregated one — even
though the two expressions are disjoint by construction. A month and a year of
the same timestamp are as independent as any two columns; the check appears to
work on the underlying column rather than on the expression over it.

The workaround costs nothing here: group one level finer, one row per
merchant-month, and count rows in the caller. But the caller then has to group
in MDL, which has no map — so it reads the view sorted by merchant and
accumulates in a single pass, flushing when the key changes and once more at the
end. That trailing flush is the part that is easy to forget and silently drops
the last merchant.

Worth knowing before designing a view around a distinct count of a date part.

### 89. A pluggable widget's stylesheet only reaches the bundle if the component imports it — and `"width": "container"` fails silently without it

The Vega widget shipped with `src/ui/VegaChart.css`, containing exactly the rule
that matters:

```css
.vega-chart { width: 100%; }
```

Nothing imported it. Mendix's build does not pick up `src/ui/*.css` on its own —
it has to be `import "./ui/VegaChart.css"` in the component — so the rule never
reached the bundle and the host div collapsed.

**The failure is invisible in every way that usually helps.** The widget
rendered. `mx check` was clean, the console was silent, no error boundary
tripped, the SVG existed in the DOM with the right height, and the marks were
all there — 67 on one chart, 850 on another. They were simply laid out inside
zero width:

```
{"i": 0, "hostW": 0, "kind": "svg", "w": 0, "hgt": 280, "marks": 67}
{"i": 2, "hostW": 1005, "kind": "svg", "w": 1005, "hgt": 241, "marks": 475}
```

Index 2 is the calendar, the one chart with a fixed `"width": 900` rather than
`"width": "container"`. A spec that asks for its container's width gets zero when
the container has no width, and zero is a legal width — so Vega renders a
correct, complete, invisible chart.

Two things generalise. **A chart that draws nothing is not obviously different
from a chart with no data**, so the first instinct is to go looking at the
payload, which was fine all along; measuring the host element found it in one
step. And **`"width": "container"` makes a spec depend on CSS**, which is a
coupling worth knowing you have taken on — the fixed-width chart was immune.

### 90. Page-spanning state needs a single owner, and navigation is page-spanning state

Not an mxcli bug — a design lesson this project paid for twice before naming it,
recorded because the shape recurs.

Navigation was written by four files: `05`, `11`, `16` and `22`, each carrying
the menu as it stood when that slice was built. Applying the set in order worked,
because the last writer won. Applying any single file did not: running `11` on
its own reverted the menu to a four-item version from before Budgets and the
Dashboard existed, silently and successfully.

```
$ grep -l 'create or replace navigation' mdlsource/*.mdl
mdlsource/05-pages-foundation.mdl
mdlsource/11-cashflow-page.mdl
mdlsource/16-budgets-page.mdl
mdlsource/22-dashboard-page.mdl
```

The trap is a property of the statement: `CREATE OR REPLACE NAVIGATION` replaces
the *whole profile*, so every file that touches it must know about every page
that exists — which none of them can, since they run before the later ones. Each
file was locally correct and the set was globally wrong.

Navigation now lives in `27-navigation.mdl` alone, applying last, after every
page it names exists. That also made adding an Insights item a one-line change
rather than a decision about which of four files to edit.

The general rule, which is worth stating because MDL will keep offering
whole-object replacement statements: **if a statement replaces an object that
spans the whole app, exactly one file may issue it, and it must be the last one
that needs to.** The same reasoning applies to `ALTER SETTINGS` and to project
security.

### 91. Adding a column to a view's GROUP BY silently changed what a row count meant downstream

Making the Insights charts filterable by account meant carrying `AccountName`
into the three aggregate views and grouping by it. That is a one-line change per
view, and it looked free.

It was not, because one downstream microflow was counting *rows* as a proxy for
something else. `BUILD_SavingsData` decides which merchants are recurring:

```
set $CurMonths = $CurMonths + 1;      -- one row per month, before
```

VMerchantMonth had been grouped by merchant, category and month, so a row *was*
a month and counting rows counted months. After the change it is grouped by
account too, so a merchant billing two cards in March is two rows and one month.
The count inflates, and it does not merely inflate a label — it is the divisor
in the annual projection (`total / months * 12`), so every multi-account
merchant's ranking silently shifts.

The fix is to count the key rather than the rows:

```
if $R/MonthIndex != $CurLastMonth then
  set $CurMonths = $CurMonths + 1;
  set $CurLastMonth = $R/MonthIndex;
end if;
```

**Nothing would have caught this.** `mx check` passes either way — the types are
identical and the query is valid. The chart still renders, still ranks, still
looks entirely reasonable; only the numbers are wrong, and only for merchants
that use more than one account. It was found by reasoning about the change, not
by running it.

The general shape is worth naming, because a grouped view invites it: **a row
count is only a count of the thing you mean while the grain stays the same, and
the grain is set somewhere else.** Any microflow that counts rows from a view is
coupled to that view's GROUP BY, invisibly and without a reference the tooling
can follow. `SHOW REFERENCES OF` finds the entity, not the assumption.

The charts had the opposite problem and it cost nothing: they also became
finer-grained than the buckets they draw, and a spec absorbs that with one
keyword — `"aggregate": "sum"` on the encoding. Summing in the spec is free.
Summing in MDL would need a map it does not have. The same change was a bug on
one side of the split and a no-op on the other, which is a fair summary of why
the split is there.

### 92. A clicked mark's datum is not the row you sent it

Wiring a click from a Vega chart back into Mendix works — the widget writes the
clicked datum as JSON, a microflow reads a field out of it, and a detail panel
is built from the model. What took the time was that the datum arriving at the
handler is not the row the model emitted, in two independent ways.

The payload for a calendar day goes out as:

```json
{"d":"2026-08-10","v":2409.16,"n":3}
```

and the datum for the rect that renders it comes back as:

```
week_d=Sun Dec 25 2011 00:00:00 GMT
day_d=Wed Jan 04 2012 00:00:00 GMT
d=1735689600000
year_d=Wed Jan 01 2025 00:00:00 GMT
sum_v=119.83000000000001
sum_n=2
```

**A temporal field is epoch milliseconds.** `d` was sent as `"2026-08-10"` and
returns as `1735689600000`. Vega parses fields it is told are temporal, and the
parsed value is a number — not a `Date`, so a widget converting `Date` instances
back to ISO (which this one does) never sees it. Reading it as a date in MDL
would mean carrying a Long through `addMilliseconds`, for a value that was a
clean string before the chart touched it.

**An aggregated mark carries only its groupby.** `v` and `n` are gone, replaced
by `sum_v` and `sum_n`; the timeUnit-derived `week_d`, `day_d` and `year_d` are
present because they are what the encoding groups by. Any field the spec does
not reference is dropped before the mark exists. The two effects compound: the
one field that survived was the one that had been mangled.

The fix is to make the click contract explicit rather than inferring it from the
chart's own encoding — carry the key twice:

```
+ '{"d":"' + formatDateTime($R/TxDate, 'yyyy-MM-dd') + '"'      -- what the chart draws
+ ',"day":"' + formatDateTime($R/TxDate, 'yyyy-MM-dd') + '"'    -- what the click reads
```

and pull the second into the groupby so the aggregate cannot discard it:

```json
"detail": {"field": "day", "type": "nominal"}
```

One calendar cell is one date, so grouping by it adds no marks — it only stops
the field being dropped. The handler then reads `day`, a plain string that no
encoding parses, and the round trip is exact: clicking 10 August 2026 returns
three transactions totalling € 2,409.16, which is what Postgres reports for that
day.

**The general lesson is that a chart's datum is an output of the rendering
pipeline, not an echo of the input.** Anything a click needs to send back should
be carried as its own field, in a type the spec has no reason to transform, and
referenced by the spec so it survives aggregation. Relying on a field the chart
happens to encode couples the click handler to the visual design — change the
encoding and the click breaks, silently, with `mx check` clean and the chart
still rendering perfectly.

### 93. `mxcli test --local` rebuilds the deployment folder underneath a running app, leaving a white screen

Symptom: the app serves HTTP 200, `mx check` is clean, the runtime log is quiet,
and the browser shows nothing at all. No error, no partial render — a blank
page.

The one useful signal is in the network panel:

```
dist/index.js?639222440940684304 :: net::ERR_ABORTED   (404)
```

`index.html` is served, the client bundle is not. And the reason is that
`deployment/web/dist/` no longer exists:

```
$ ls Ledger/deployment/web/dist/
ls: cannot access 'Ledger/deployment/web/dist/': No such file or directory
```

**What removed it was the test runner.** The app had been started at 18:49 and
had bundled its web client successfully (`Web client bundled in 1m1.026s`).
`mxcli test --local` was then run against the same project, and it rebuilds the
deployment directory for its own purposes:

```
$ ls -la --time-style=+%H:%M:%S Ledger/deployment/
drwxr-xr-x 13 root root 4096 18:55:02 .
$ ls -la --time-style=+%H:%M:%S Ledger/.mxcli/
-rw-r--r--  1 root root 98015 18:55:21 test-runtime.log
```

A test run has no use for a web client, so its build does not produce one — and
because it writes into the *same* `deployment/` the running app is serving from,
the live bundle is deleted rather than duplicated. The running runtime keeps
serving `index.html` from the same directory, so nothing appears to be wrong
from the server's side. The failure is entirely in the browser and entirely
silent.

**The fix is a restart**, which rebuilds the client. Nothing is lost and the
model is untouched — this is not corruption, only a missing artefact.

**The rule is: do not run `mxcli test --local` while `mxcli run` is live.** That
is the same shape as the rule this project already had about `mx check` during a
`--watch` loop, and for the same underlying reason — two tools sharing one
build directory, one of them assuming it owns it. Worth mxcli either using a
scratch deployment directory for test runs, or refusing to start when it can see
a runtime already serving from that folder.

This had been hit once before and written off as "a running app process had lost
its deployment"; the mechanism is above, and the trigger was the tests.

### 94. Vega-Lite sizes facet rows to their content, so a table built from side-by-side faceted panels drifts out of alignment

Not an mxcli finding — a Vega-Lite one — but it cost a deploy cycle and the
diagnosis is worth writing down, because the symptom points at the wrong thing.

The dashboard is a Tufte-style table: one row per category, four columns
(sparkline, year-on-year delta, this year's total, recurring share). Vega-Lite
cannot put a concatenation inside a facet, so the only way to build it is the
other way round — an `hconcat` of four separately faceted panels, each faceted
on the same field, with the same sort and the same declared row height:

```json
"spec": {"width": 300, "height": 26}
...
"config": {"facet": {"spacing": 3}}
```

Same height, same spacing, same sort, same fourteen categories. The rows still
did not line up. At the top of the table the label sat 13px below its number;
by the bottom row the drift was a full row, so "Needs review" was reading
against Subscriptions' total.

Measuring the rendered scenegraph rather than the screenshot showed why:

```
concat_1_concat_0_cell: rows=14 first=164 last=569 gaps=29,31,32
concat_1_concat_1_cell: rows=14 first=164 last=567 gaps=31
concat_1_concat_2_cell: rows=14 first=164 last=541 gaps=29
```

Three panels, three different row pitches — and the sparkline panel's pitch is
not even constant, varying row by row between 29 and 32.

**Facet layout defaults to `bounds: "full"`, which sizes each row to its
content's bounds rather than to the declared height.** Any mark that overflows
the 26px cell pushes its own row taller: the outlier dots (`point`, `size: 22`)
straddle the sparkline, so a row whose outlier sits near the top or bottom of
its band grows — which is exactly why that panel's pitch varies with the data.
The `vs last year` panel has a `rule` drawn to the row edge and grows by a
constant 2px. The `this year` panel is plain text, overflows nothing, and is the
only one at the declared 29px pitch. Nothing is wrong with any single panel; the
table is wrong because the panels disagree.

The fix is one property per panel:

```json
"bounds": "flush"
```

which lays rows out on their declared size and lets marks overflow visually.
All four panels then measure identically:

```
concat_1_concat_0_cell: rows=14 first=164 last=541 gaps=29
concat_1_concat_1_cell: rows=14 first=164 last=541 gaps=29
concat_1_concat_2_cell: rows=14 first=164 last=541 gaps=29
```

**The general rule: whenever alignment across concatenated faceted panels
carries meaning — which is the whole point of a small-multiples table — set
`bounds: "flush"` on every panel.** Equal `height` is not sufficient, because
`height` is an input to the layout, not a guarantee about it.

`flush` has a cost, and it is worth knowing before choosing it: the layout stops
measuring content, including the row header. The category labels are drawn to
the left of the panel origin, the view is only as wide as the layout says, and
so the longest label was cut off by the SVG viewport — a *clip*, not a
truncation, so there was no ellipsis to give it away and `labelLimit` had nothing
to do with it. The fix is to reserve the space the layout no longer computes,
with `padding.left`.

### Two more ways the same table came apart

Both were introduced while fixing something real, and both are the same shape:
a change that is locally correct and breaks an invariant three panels away.

**A transform that aggregates away the sort field silently reorders one panel.**
The model emits a row per category per month per *account*, so a category held
on two accounts arrives as two values at the same x — and a line mark does not
aggregate, it joins them in order. Every multi-account category drew a sawtooth.
The fix is a `sum` aggregate inside the facet spec, grouped by category and
month. What that also did was drop `ord`, the field the *facet row sort* is
computed on. Nothing errored. The row domain is built from the data as the spec
leaves it, so panel 0 fell back to alphabetical while the other three panels
stayed on the sort — four columns, each labelled correctly, describing four
different categories per row. Keeping `ord` in the `groupby` is the whole fix.

**Filtering a panel changes its row domain; filtering its layers does not.**
The recurring-cost column shares one x scale across rows, so Salary at 43,661
compressed every spend bar to a sliver — and a salary has no standing cost to
cancel, so it should not be in that scale at all. Filtering income out at the
*panel* level would have removed Salary and Freelance from that facet's row
domain: twelve rows against the other panels' fourteen, and the table is
misaligned again. Filtering inside the two layers leaves the rows in place and
empty, which is the honest reading, and hands the scale back to Rent.

The invariant worth stating: **every panel in the table must produce the same
facet domain, in the same order.** A check for it is four lines against the
compiled view, and it catches both of the above before a deploy:

```js
for (let i = 0; i < 4; i++) console.log(view.data(`concat_1_concat_${i}_row_domain`))
```

### Method

Three notes, all of which paid for themselves several times over:

- **Do not measure a screenshot.** The first diagnosis was made from pixel
  positions in a captured PNG, which was scaled relative to the viewport and
  gave non-integer pitches that fitted no hypothesis. Reading `y` straight off
  the Vega scenegraph gave exact numbers immediately.
- **Compile and render the spec in node, not in the app.**
  `widgets-src/vegachart/x.mjs` extracts the spec from the MDL page file;
  `m.mjs` runs it headless against synthetic rows shaped like the real dataset
  and prints the row pitch of every panel; `o.mjs` prints each panel's row
  domain; `h.mjs` locates the header label against its row; `v.mjs` sweeps
  candidate fixes over all of it. Testing five variants took three seconds;
  testing one variant through the app takes three minutes.
- **Shape the synthetic data like the real data, including its awkward parts.**
  `o.mjs` emits two accounts for one category precisely because that is the case
  that broke the sparklines. Synthetic data that is uniformly well-behaved
  reproduces nothing.

### 95. A theme workaround outlived the problem it worked around, and Atlas turned it into a broken collapse

Reported symptom: the left menu does not collapse to a thin icon rail — the
panel stays wide, collapsing hides *some* of the labels, expanding shows all of
them again.

Three separate causes, and the interesting one is that the first was a
deliberate choice that had simply gone stale.

**1. The closed width was pinned to the open width.** `custom-variables.scss`
carried this, with its reasoning attached:

```scss
/* Sidebar: dark, and permanently open at the prototype's 224px. Setting the
   closed width equal to the open one is what keeps it from collapsing to a
   48px strip of clipped labels. */
--navsidebar-width-closed: 224px;
--navsidebar-width-open: 224px;
```

That was correct when it was written: the menu had no icons, so a 48px rail
would have shown nothing but the first two letters of each caption. Icons were
added later (finding 81), which made the workaround unnecessary — and worse than
unnecessary, because Atlas hangs behaviour off that token:

```scss
& > a {
    .glyphicon, .mx-icon-lined, .mx-icon-filled {
        flex-basis: var(--closed-sidebar-width);
    }
}
```

With the closed width at 224px, every glyph claimed the entire row while closed
and pushed its caption out of a sidebar that clips its overflow. **The labels
were never hidden; they were shoved sideways.** That is the whole of "collapsing
hides the labels but the panel stays wide".

Measured from the running app, before and after `--navsidebar-width-closed: 52px`:

```
before   sidebarW 224   iconW 224   (caption pushed past the clip)
after    sidebarW  52   iconW  52   (caption clipped, icon on its slot)
```

**2. One menu item used an icon from a collection Atlas' navigation rules do not
match.** `Transactions` carried `Atlas_Core.Atlas_Styling."aligncontent-horizontal-space-between"`.
That collection is real and the icon renders, but it has a different CSS prefix:

```
| Icon Collection          | Prefix              | Icons |
| Atlas_Core.Atlas_Styling | Atlas_Core_Controls |    38 |
| Atlas_Core.Atlas_Filled  | mx-icon             |   366 |
| Atlas_Core.Atlas         | mx-icon             |   366 |
```

Atlas' navigation styling matches `.glyphicon, .mx-icon-lined, .mx-icon-filled`,
so an `Atlas_Core_Controls-*` glyph is skipped by every one of those rules —
including the `flex-basis` rule above. That is why exactly one caption stayed
visible while the other six were pushed away, and why the symptom read as "some
labels" rather than "the labels". Re-pointed at `Atlas_Core.Atlas."cash-payment-bill"`.

**The general rule: an icon collection's prefix is part of its contract.**
`mxcli` validates that the icon *exists* — which it does — but nothing checks
that the collection is the one the surrounding component styles for. Two
collections named in the same completion list are not interchangeable.

**3. The project's own sidebar CSS was written for 224px only.** With the rail
working, the wordmark `::before` ('Ledger', 19px serif) and the kicker
('Household finances', letter-spaced uppercase mono) were clipped mid-word, and
20px of padding on the tree plus 20 on the anchor left 12px for a 52px icon slot,
so the icons overflowed the rail instead of sitting in it. Atlas expresses the
state on the scroll container rather than on the sidebar, so the collapsed rules
hang off the selector Atlas uses itself:

```scss
.mx-scrollcontainer-shrink:not(.mx-scrollcontainer-open) > .region-sidebar { … }
```

At 52px the wordmark becomes `L`, the kicker becomes the rule that was under it,
and the paddings go to zero.

One trap inside that: `justify-content: center` on the row seems obviously right
and is wrong. The caption is still in the row — only ever clipped, never removed
— so the row's content is ~130px wide inside a 52px box, and centring that
overflow pushes the icon off the left edge and leaves the first few letters of
the caption sitting where the icon should be. Left-aligned, the icon lands on
its 52px and the caption falls off the right, where the sidebar clips it.

One thing this did **not** fix: at 224px open, the longest caption still clips —
'Categories & rules' reads as 'Categories &'. The row wants 205px of content in a
160px box, and narrowing Atlas' 52px glyph slot to 30px leaves it 23px short, so
that is a caption too long for the sidebar rather than a slot too wide. Both
honest fixes (a shorter caption, a wider sidebar) change a decision the prototype
made, so neither was taken unilaterally. The measurement is also from a container
where IBM Plex cannot be fetched, so the real shortfall is smaller than 45px and
may be zero.

The lesson worth keeping is the first one. **A workaround should carry the
condition that justifies it, not just the reasoning that motivated it** — the
comment here explained itself perfectly and still went silently wrong, because
the thing it was compensating for ("this app has no glyphs", stated in a second
comment in a second file) stopped being true.

### 96. OQL divides with `:` — `/` is the association traversal operator

Recorded because the wrong conclusion was reached first, published, and then
corrected by the reader.

`sum(a) / count(b)` is rejected, and mxcli's message is accurate about why:

```
Error: invalid OQL in view entity 'Ledger.VP11':
  - '/' is the association traversal operator in OQL, not division. Found: '...) / c...'
```

The runtime's own parser agrees, and its error carries the answer:

```
Error on line 1 character 21: mismatched input '/'
  expecting {'*', ')', '+', '-', ':', '%', '^', '&', '|', DOT, SLASH}
```

**`:` is in that list, and `:` is division.** Verified against the engine:

```
select sum(t.Amount) : count(t.id) as M, avg(t.Amount) as A from Ledger.Transaction as t
| A                   | M                   |
| 237.377950643776824 | 237.377950643776824 |
```

and it compiles to plain SQL division — from the generated statement:

```sql
(SUM("b"."MerchantTotal") / ( SELECT SUM("b2"."MerchantTotal") FROM ( … ) "b2" ))
```

So shares, ratios, per-month averages and variance percentages are all
expressible in a view. There is no `div()` function (`Unknown function 'div'`),
and `abs` and `substring` remain unknown while `round` and `avg` exist.

**The methodological point is the one worth keeping.** The token list in that
parser error is an enumeration of every operator the grammar accepts — it was
printed, quoted in a written answer, and still read past, because the search was
for a *function* named something like `div` and `:` does not look like an
operator. When a parser tells you what it expected, that list is the language
reference, and it is more current than any documentation.

### 97. One view can carry several aggregation grains, and a constraint on the grain prunes the rest before it touches a table

A view entity takes no parameters, so its aggregation grain is fixed when the
model is written. That reads like a hard limit — "total per category for the
period the reader picked" seems to require either a parameter or re-summing
downstream. It does not. **Put every grain in one view as a `UNION ALL`, tag
each branch with a constant, and constrain on the tag.**

```sql
select 'all' as Grain, … group by c.Name
union all
select 'account' as Grain, … group by c.Name, a.Name
```

The concern is obvious: does the reader pay for the grains it did not ask for?
**No.** Mendix wraps the view in a subquery and applies the constraint outside
it, passing every literal as a bind parameter:

```sql
SELECT "v"."CategoryName", "v"."Total"
FROM ( (branch1) UNION ALL (branch2) UNION ALL (branch3) ) "v"
WHERE "v"."Grain" = $12 AND "v"."Yr" = $13
```
```
parameters: $1 = 'cat-month', $4 = 'cat-year', $8 = 'merchant-year',
            $12 = 'cat-year', $13 = '2026'
```

Postgres flattens that into an append relation and pushes the qual into each
branch, where it meets a constant and folds:

```
Append (actual rows=13)
  ->  Subquery Scan "*SELECT* 1" (actual rows=0)
        ->  HashAggregate (actual rows=0)
              ->  Result (actual rows=0)   One-Time Filter: false
  ->  Subquery Scan "*SELECT* 2" (actual rows=13)
        ->  GroupAggregate (actual rows=13)
              ->  Seq Scan on "ledger$transaction" t (actual rows=372)
  ->  Subquery Scan "*SELECT* 3" (actual rows=0)
```

It survives the failure mode worth checking. Under `force_generic_plan`, where
the tag is not a plan-time constant, the branch is skipped at execution instead:

```
->  Result (actual rows=0)   One-Time Filter: ($1 = $4)
      ->  Seq Scan on "ledger$category" c (never executed)
```

Custom plan or generic plan, one branch runs. Note the second win in that plan:
`Yr = 2026` was pushed into the surviving branch as well, cutting its scan from
912 rows to 372 — the constraint reaches the aggregation, not just its output.

Two costs, both real:

- **Union compatibility.** Every branch emits every column, so grains that lack
  one carry a sentinel `''` or `0`. The entity ends up with columns that are
  meaningless for some of its rows, and nothing in the type system stops a
  consumer from forgetting the grain filter and getting a mixed bag.
- **CE6770 on the first attempt.** A literal or derived column normalises to
  `string(200)` regardless of source (finding 36), so a branch mixing a
  pass-through `c.Name` (100) with a literal `''` (200) matches no single
  declaration. `cast(… as string)` on every string column in every branch, all
  declared `string(200)`. The error names the entity, not the column.

**Where it does not help:** the grain must still be enumerable at design time.
`VYoY` uses it for the account dimension — 'all' versus 'account' — because that
is a choice between two known aggregations. The savings chart cannot use it: its
`MonthsActive` is a count of distinct months *within the selected period*, so
the aggregate depends on a window chosen at runtime, and no finite set of
branches covers that. That builder keeps its grouping, and the boundary is
exactly there — **a view can offer a menu of grains, not a function of one.**

Verified on Postgres 16 only.

### 98. A view entity selecting from another is inlined, not materialised — which is why CTEs are a convenience here rather than a gap

`with x as (…) select …` is rejected by both layers:

```
Parse error: line 4:2 mismatched input 'with' expecting {SELECT, FROM}      (mxcli)
Error on line 1 character 0: mismatched input 'with'
  expecting {'SELECT', 'FROM', 'DELETE', 'INSERT', 'UPDATE'}               (runtime)
```

That looks worse than it is. Inline views work (`from (select …) as x`), and so
does a view entity selecting from another view entity — and the second is the
better tool, because it names the derived table at *model* scope where several
queries can share it, rather than at query scope.

**And Mendix inlines it.** `VWTop` selecting from `VWBase` produces one
statement with `VWBase` expanded in place — no round trip, no temp table:

```sql
SELECT "v"."CategoryName", "v"."Recurring", "v"."Share" FROM (
  SELECT "b"."CategoryName", SUM("b"."MerchantTotal") AS "Recurring",
    (SUM("b"."MerchantTotal") / ( SELECT SUM("b2"."MerchantTotal") FROM ( …VWBase… ) "b2" ))
  FROM ( …VWBase… ) "b"
  WHERE "b"."MonthsActive" >= $5 GROUP BY "b"."CategoryName" ) "v"
```

**What is actually lost without CTEs is single evaluation, not expressiveness.**
`VWBase` appears twice above, and Postgres runs it twice:

```
GroupAggregate (actual rows=13)
  InitPlan 1 (returns $0)
    ->  Aggregate -> GroupAggregate (actual rows=35)
         ->  Seq Scan on "ledger$transaction" t_1 (actual rows=372)   <- once
  ->  Subquery Scan on b -> GroupAggregate (actual rows=32)
         ->  Seq Scan on "ledger$transaction" t (actual rows=372)     <- twice
```

Identical subqueries, no sharing. `WITH b AS MATERIALIZED (…)` would compute it
once. At 900 rows that is noise; the cost scales with how many times the derived
table is referenced, so it bites exactly on the percent-of-total shape, where the
denominator is the same aggregate as the numerator.

The one thing neither inline views nor view-on-view can express is
`WITH RECURSIVE`. Not needed for a two-level taxonomy; it is the real hole for a
hierarchy of unknown depth.

### 99. CE0174's column-not-expression rule applies to enums too, and the way out is to stop mentioning the column

Finding 88 recorded this for dates: a `datepart` in the GROUP BY makes the whole
column grouped, so no other `datepart` of it may be aggregated. The rule is not
about dates. Adding a signed total to a view already grouped by group type:

```sql
sum(case when cast(g.GroupType as string) = 'Income' then t.Amount
         else 0 - t.Amount end) as Signed
…
group by …, cast(g.GroupType as string), …
```
```
[error] [CE0174] "Error(s) in OQL query: Column 'g.GroupType' cannot both be
        aggregated and appear in the GROUP BY clause." at Entity 'Ledger.VMonthCategory'
```

The two expressions are the *same* expression here, which makes it clearer than
the date case what the checker is doing: it resolves both to the underlying
column and refuses, without asking whether the result would be ambiguous. It
would not be — every row in a group has the same `GroupType` by construction, so
the CASE is constant within the group.

**The fix is not to rephrase the aggregate but to reach the same number without
naming the column.** `Transaction.SignedAmount` already carries the direction,
so `sum(t.SignedAmount)` is the signed total by a route the checker has no
objection to. That is only correct if the sign always agrees with the group
type, which is a data assumption, so it was checked rather than assumed:

```
Expense|-1|840|0
Income |+1| 60|0
```

840 expense rows all negative, 60 income rows all positive, and
`|SignedAmount| = Amount` in every one — the third column is a count of rows
where they disagree.

**The general shape: when CE0174 blocks an expression, look for a column that
already carries the answer.** Rephrasing the aggregate will not help, because
the checker is not reading the expression.

### 100. `bounds: "flush"` also stops the layout aligning row-header labels, and the DOM says they are aligned

Reported as "the category labels on the left are not aligned", which they were —
by up to sixty pixels. What made it hard to see is that every one of them
insisted otherwise:

```
Salary               anchor=end translate(0,3) L=244 R=276
Rent                 anchor=end translate(0,3) L=259 R=282
Savings transfer     anchor=end translate(0,3) L=155 R=237
Restaurants & cafes  anchor=end translate(0,3) L=120 R=221
```

Identical `text-anchor="end"`, identical local transform, right edges 61px
apart. Rendering the same spec headless gave `distinct x = 1` — right-aligned,
as declared. The spec was not wrong and the browser was not wrong.

**The alignment is not the label's, it is the group's.** Each facet row's header
is its own group, and `bounds: "flush"` — needed so the four columns keep the
same row pitch (finding 94) — stops the layout measuring those groups. Each one
comes to rest at its own text width, and a label right-anchored at x=0 inside a
group that starts wherever is ragged no matter what its anchor says. Node's
render agreed because its font metrics are uniform, so every group landed in the
same place.

Chasing it through header properties is wasted effort: `labelAnchor` positions
the label *along the row* (and on a row header the anchors read backwards —
`start` puts it on the bottom edge, `end` on the top), `labelAlign` sets the text
anchor, and neither of them moves the group.

**The fix is to stop using the header.** The category names are a column of the
table, so they are drawn as one — a fifth faceted panel with
`header: {labels: false}` and a text mark right-aligned at a fixed x:

```json
"spec": {
  "width": 118, "height": 26,
  "mark": {"type": "text", "align": "right", "fontSize": 10},
  "encoding": {
    "x": {"datum": 118, "axis": null, "scale": {"domain": [0, 118]}},
    "text": {"field": "cat", "type": "nominal"}
  }
}
```

Every label now ends at the same pixel:

```
Salary               R=289      Restaurants & cafes  R=289
Rent                 R=289      Internet & phone     R=289
Savings transfer     R=290      Needs review         R=289
```

(The 290 is one glyph's right side bearing, not a misalignment.)

It is also the better structure. The panel count check in `o.mjs` was hard-coded
to four and would have gone on reporting agreement across a table that now has
five columns, so it was changed to iterate until the dataset runs out — a check
that silently stops measuring is worse than no check.

### 101. The viewport Playwright is asked for is not always the viewport it gets, and the failure looks like a broken feature

Twice now. The first time it produced a whole false diagnosis of a chart
"growing horizontally"; the second time it made half a chart look unclickable.

Clicking the delta bars of a fourteen-row table, rows 0–11 selected their
category and rows 12–13 did nothing:

```
bar 11 y=706 -> title="Internet & phone"
bar 12 y=735 -> title="Internet & phone"    <- unchanged
bar 13 y=764 -> title="Internet & phone"    <- unchanged
```

The marks were in the DOM with correct bounding boxes. What gave it away:

```js
document.elementFromPoint(697, 739)   // -> null
```

`null` from `elementFromPoint` at a coordinate that is inside the element's own
bounding box means the point is outside the *viewport*. And it was:

```
requested: { width: 1600, height: 1400 }
actual:    { w: 1280, h: 720 }
```

`browser.newPage({ viewportSize })` had been ignored. Everything below y=720 was
off-screen, `page.mouse.click()` at those coordinates went nowhere, and the app
looked broken for exactly the rows that mattered — including the one the whole
change was about.

**Three habits that make this class of bug cheap:**

- `page.setViewportSize()` *after* creating the page applies reliably where the
  constructor option did not.
- Prefer `elementHandle.click()` over `page.mouse.click(x, y)`: it scrolls the
  element into view first, so it is immune to this entirely.
- Assert the viewport you got. One line —
  `await p.evaluate(() => ({w: innerWidth, h: innerHeight}))` — printed at the
  top of every run would have caught both incidents in seconds.

The general lesson is the same one as finding 94's "do not measure a
screenshot": **the browser is an instrument, and an instrument that has silently
changed scale reports confident nonsense.** Check the instrument before
believing the measurement.

### 102. A field named in a tooltip without an aggregate silently becomes part of the group-by, and un-aggregates the chart

Reported as "the income against spend chart looks a bit weird for the Daily
living category" — thin white slivers cutting through the stacked bands.

**The first hypothesis was wrong and worth recording as such.** Stacked areas
with `interpolate: "monotone"` are a known source of exactly this look: each
band's top and bottom are smoothed independently, so two curves fitted to the
same numbers diverge between data points and the background shows through.
Switching to `linear` is correct on its own merits and changed nothing here.

Measuring the geometry settled it. Reading each band's top and bottom edge at
x=0 out of the SVG:

```
top 175.13  bottom 171.49
top 175.76  bottom 175.13     <- 0.63px tall
top 179.57  bottom 175.76     <- GAP of 3.81px
top 180.48  bottom 179.57
```

Four gaps, totalling 19.7px. The bands either side were contiguous, so the stack
had reserved the space and no mark had been drawn in it — and 0.63 + 3.81 is
exactly Shopping's height for that month. One band, drawn as two pieces, with
the stack's space for the missing middle showing through.

**Four gaps, and exactly four categories are held on two accounts.** The view is
grained by account, so a month/category is one row per account, and the chart
aggregates that away:

```json
"y": {"field": "v", "aggregate": "sum", "stack": "zero"},
"color": {"field": "grp"}, "detail": {"field": "cat"},
"tooltip": [ …, {"field": "v", "title": "Amount"} ]
```

That last line is the bug. **Vega-Lite adds every field named in an encoding
channel to the implicit GROUP BY unless it carries an aggregate, and `tooltip`
is an encoding channel like any other.** The raw `v` in the tooltip put `v` back
in the grouping, so the sum no longer collapsed accounts: two rows survived per
(month, category), the area mark connected them as one path that jumped between
two stacked positions, and the jump is the sliver.

The tooltip had been reporting it all along, which is the part worth
remembering. From the original bug report's screenshot:

```
Category Groceries   Month Jun 2026   Amount −517.47
```

and from the database:

```
ING Betaalrekening   -517.47
Revolut              -180.23
TOTAL                -697.70
```

The number on screen was one account's share, not the month. The chart was
telling the truth about its own broken grouping and it read as a rendering
artifact.

The fix is one keyword:

```json
{"field": "v", "aggregate": "sum", "title": "Amount", "format": ",.2f"}
```

Every band edge then meets the next exactly — thirteen bands, twelve boundaries,
zero gaps — and the tooltip reports −697.70.

**The rule: in a chart that aggregates, every field in every channel needs an
aggregate — including the ones that only exist to be read by a human.** A
tooltip looks like annotation and behaves like a dimension. The tell is a
tooltip whose number is smaller than the mark it is attached to.

---

## Phase 13 — the sparkline moves into the table (2026-08-14)

The small-multiple grid below the cashflow matrix became a column of the matrix
itself: one sparkline per row, beside the twelve figures it summarises. Getting
there turned up how a page loses a widget nobody deleted, and how little of a
pluggable widget survives a `DESCRIBE`.

### 103. An `ALTER PAGE ... INSERT` is erased by the next run of the file that owns the page, and nothing reports it

The sparklines disappeared from the cashflow page. No commit removed them, no
error mentioned them, and `mx check` reported 0 errors both before and after.

The two files:

```
11-cashflow-page.mdl    create or replace page Ledger.Cashflow_Overview { ... }
23-cashflow-sparklines  alter page Ledger.Cashflow_Overview {
                          insert after lgMatrixRow { ... the chart ... } }
```

Editing the matrix — making the inspector's rows clickable — meant re-running
file 11. `CREATE OR REPLACE PAGE` rebuilt the page from its own source, and file
23's insert was simply not in that source. The chart was gone from that moment,
in a commit whose diff mentions only an `onclick`.

Nothing catches this. A page missing a widget is a perfectly valid page, so the
validator has nothing to say; the runtime renders what it is given; and the two
files never appear in the same diff. It surfaces when someone looks at the
screen.

File 23 had even documented its own fragility, and documented the wrong half:

```
-- Idempotency, and the one place this file is not. [...] re-running *this file
-- alone* against a page that already carries the chart fails with "duplicate
-- widget name 'lgSparkRow'". In the canonical flow it is fine: file 11
-- recreates the page from scratch before this one inserts into it.
```

The hazard identified was applying file 23 twice. The hazard that fired was
applying file 11 once. "File 11 recreates the page from scratch before this one
inserts into it" is true only while the files are applied as a set, and the
whole point of `create or modify` everywhere else in this project is that a
single file can be re-applied on its own.

**This is the navigation trap again** (finding 81, and the four-file menu before
it): state that spans files needs one owner. For a page, the owner is whichever
file holds its `CREATE OR REPLACE PAGE`. The sparkline column now lives there,
and file 23 is gone.

What would make `ALTER PAGE` safe to depend on is idempotency —
`INSERT ... IF NOT EXISTS` paired with `DROP WIDGET ... IF EXISTS` — because
then "apply every file in order" repairs the page instead of racing it, and an
alter file re-applied on its own is a no-op rather than a duplicate-name error.
Neither form exists today:

```
$ mxcli check drop-if-exists.mdl
  - line 1:18 extraneous input 'exists' expecting the start of a statement
```

### 104. `DESCRIBE PAGE` does not round-trip a pluggable widget: strings lose their quotes and booleans vanish

A probe page with two Vega widgets, one spec on a single line and one across
several:

```sql
pluggablewidget 'ledger.widget.web.vegachart.VegaChart' pw1 (
  datasetName: 'table', chartHeight: 30, renderer: 'svg', showActions: true,
  spec: '{"a": 1}')
```

comes back from `DESCRIBE PAGE` as:

```
pluggablewidget 'ledger.widget.web.vegachart.VegaChart' pw1 (
  spec: {"a": 1},
  datasetName: table,
  chartHeight: 30,
  renderer: svg
)
```

Every string property has lost its quotes — `spec`, `datasetName` — and
`showActions` is not in the output at all. Feeding the description of the real
cashflow page back through the checker fails from the first widget onward:

```
$ mxcli -c "DESCRIBE PAGE Ledger.Cashflow_Overview" | sed -n '/^create or modify page/,$p' > rt.mdl
$ mxcli check rt.mdl
  - line 380:75 extraneous input ':' expecting the start of a statement
  - line 380:83 extraneous input ',' expecting the start of a statement
  - line 384:50 extraneous input '(' expecting the start of a statement
```

The model is fine — this is an output defect, not a storage one. The property is
in the `.mxunit`:

```
$ grep -ac showActions mprcontents/e4/5b/e45bbab7-....mxunit
2
```

Two widgets, two occurrences, exactly as written. It is `DESCRIBE` that drops
it.

That matters more than a cosmetic complaint because DESCRIBE-edit-CREATE OR
REPLACE is the documented way to modify an element you did not author — it is
how `mxcli` itself tells you to change navigation. Any page carrying a pluggable
widget cannot be modified that way: the description will not re-parse, and if
the quoting were fixed without also emitting the booleans, it would re-parse and
silently drop a property instead. A widget was never hand-authorable in Studio
Pro terms, so this is the only route it has.

### 105. A minus followed by a plus in one expression is silently swapped, and the runtime computes the swapped version

A caption meant to read "20 months, 13 categories" rendered as:

```
48620 months, 13 categories.
```

The microflow was written as:

```sql
MonthSpan = $LastMonthSeen - $FirstMonth + 1,
```

and the model came back holding:

```sql
MonthSpan = $LastMonthSeen + $FirstMonth - 1
```

24320 + 24301 − 1 = 48620. Not a rendering artifact like finding 104 — the
running app computed it, so the corruption is in the model.

Minimal repro, eleven assignments in one microflow, written against what
`DESCRIBE MICROFLOW` gives back:

```
set $R = $A - $B;                ==  set $R = $A - $B;
set $R = $A + $B;                ==  set $R = $A + $B;
set $R = $A - $B + 1;            !=  set $R = $A + $B - 1;
set $R = $A - $B - 1;            ==  set $R = $A - $B - 1;
set $R = $A + $B - 1;            ==  set $R = $A + $B - 1;
set $R = $A + $B + 1;            ==  set $R = $A + $B + 1;
set $R = $A - $B + $C;           !=  set $R = $A + $B - $C;
set $R = $A - ($B - 1);          ==  set $R = $A - ($B - 1);
set $R = $A - $B * 2;            ==  set $R = $A - $B * 2;
set $R = $A - $B + $C - 2;       !=  set $R = $A + $B - $C - 2;
set $R = 1 - $A + $B;            !=  set $R = 1 + $A - $B;
```

**Every failure has the same shape: a `-` followed by a `+` at the same
precedence level.** All-plus chains survive, all-minus chains survive, a
parenthesised subtraction survives, and `-` against `*` survives — multiplication
binds tighter, so it never joins the additive chain. `$A - $B + $C - 2` becomes
`$A + $B - $C - 2`: the first `- +` pair swaps and the trailing `- 2` is left
alone. `1 - $A + $B` shows it is not about variables.

The additive chain is being rebuilt with its operators reassigned to the wrong
operands — the plus lands where the minus was written. `set` and an attribute
inside `create` are affected identically, so it is the expression handling, not
the statement.

**What makes it dangerous is that every layer downstream is happy.** The script
passes `mxcli check`. `mx check` reports 0 errors. The microflow runs. The only
thing wrong is the number, and a number is exactly the thing a reader assumes is
right. This one was caught because 48620 months is absurd; had the span been out
by two it would have shipped.

Scanned the rest of the project for the shape — strip comments and string
literals, split into statements, look for a `-` operator preceding a `+` at paren
depth 0 — and this was the only expression in 27 files that had it. The five
other matches were the scanner spanning a condition and its body (`if $B - $A >
… then set $Over = $Over + 1`), which are two expressions, not one, and both
round-trip intact.

The workaround is to write the same arithmetic in a form the tool preserves:

```sql
MonthSpan = $LastMonthSeen + 1 - $FirstMonth,
```

Plus before minus, identical value, and it round-trips. Parenthesising the
subtraction works too. Neither is something an author should have to know, so
the comment in `21b-dashboard-overview.mdl` says why the line is written
backwards.

---

## Phase 14 — a list you can actually work (2026-08-14)

The transactions screen was a wall of 932 rows: no search, no sorting, no paging
beyond the default, and nothing editable — so the twelve transactions the
dashboard said needed review could be counted but not acted on. Making it work
turned up three ways the tooling loses without saying so.

### 106. A doc comment with nothing after it makes the whole file unparseable — and one had been sitting in this project for weeks

`05-pages-foundation.mdl` could not be applied. Not the statement — the file:

```
$ mxcli exec mdlsource/05-pages-foundation.mdl
Parse error: line 207:0 no viable alternative at input '/**\n * Fill in the
navigation now that every target page exists. […]'
```

`mxcli check` says the same. The comment is the last thing in the file, and it
documents a statement that no longer exists: navigation moved out to file 27
when the four-file menu trap was fixed (finding 81), and its `/** … */`
introduction was left behind. A doc comment has to attach to something. A `--`
line comment in the same position is fine.

Two things make this worth writing down rather than filing as a typo.

**It is invisible in exactly the way that matters.** The pages the file owns
were already in the `.mpr`, put there before the comment was orphaned, so every
screen worked and every `mx check` was clean. Nothing reads a file that nobody
runs. It surfaced only when this session tried to *edit* the transactions page —
the first change to that file since navigation moved.

**A cold rebuild would have failed.** The project's claim is that the app is
authored entirely through MDL and can be rebuilt from `mdlsource/`. That claim
was false for as long as this comment sat there: applying the files in order
stops at 05.

The lesson is narrower than "check your comments": *when you delete a statement,
delete its doc comment with it* — and the general one, that a file which nothing
re-runs is a file nothing tests.

### 107. A grid column's `Size` is a ratio, is only read alongside `ColumnWidth: manual`, and on its own builds a broken column

The date and amount columns wanted to be about 130px, so:

```
column colDate (attribute: TxDate, caption: 'Date', ColumnWidth: manual, Size: 130, …)
column colMerchant (attribute: Merchant, caption: 'Merchant')
column colDesc (attribute: Description, caption: 'Description')
```

What rendered was a date column half the screen wide, an amount column the other
half, and three columns of nothing in between — no header captions, no cell
values. It reads as data loss, and the model is fine: `DESCRIBE PAGE` shows
`column Merchant (Attribute: Merchant, Caption: 'Merchant')` exactly as written.

`Size` is a **ratio**, not a pixel width, and the widget's default is 1. Asking
for 130 on two columns and leaving three at the default is asking for
130:1:1:1:130 — the middle three got a 260th of the width each and clipped to
nothing. The skill file says "Width in pixels (when `ColumnWidth: manual`)",
which is what sent me there; the widget's own XML says `size`, "Column size",
integer, default 1.

Dropping `ColumnWidth: manual` and keeping `Size` is worse, and this is the part
with teeth:

```
$ mx check
[error] [CE0463] "The definition of this widget has changed. Update this widget
by right-clicking it and selecting 'Update widget'…" at Data grid 2 'dgTransactions'
```

A column with a `Size` and no `ColumnWidth` builds an invalid widget. The error
does not mention the column, the property, or the page's source — it says the
widget definition changed, which is what you get when a `.mpk` was rebuilt under
a placed instance, so it sends you looking at widget versions. Eleven probe
variants isolated it:

```
plain grid                              CE0463: 0
+ PageSize                              CE0463: 0
+ Size: 3                               CE0463: 1     <-- here
ColumnWidth: manual + Size: 3           CE0463: 0
ColumnWidth: autoFit, no Size           CE0463: 0
column filter block (with manual+Size)  CE0463: 0
```

**The rule: `Size` and `ColumnWidth: manual` are one property in two halves.**
Give every column both, as a set — a ratio only means anything relative to the
other columns' ratios.

### 108. A `filter` block at grid level parses, applies, and is silently dropped

Data Grid 2 puts a filter widget in a column. Written at grid level:

```
datagrid dgTransactions (…) {
  filter fltTransactions {
    textfilter ftTxText (attributes: [Ledger.Transaction.Merchant, …])
    datefilter ftTxDate (attributes: [Ledger.Transaction.TxDate])
  }
  column colDate (…)
```

`mxcli check` passes. `mxcli exec` reports the page created. `mx check` gives 0
errors. The app builds, the grid renders — with no filters, and no filter
widgets anywhere in the model:

```
$ mxcli -c "DESCRIBE PAGE Ledger.Transaction_Overview"
datagrid dgTransactions (DataSource: …, PageSize: 25, …) {
  column TxDate (…)            <-- the filter block is simply not here
```

Inside the column it works and lands in the right region — the rendered header
carries `<div class="filter"><div class="filter-container mx-name-ftMerchant">`:

```
column colMerchant (attribute: Merchant, caption: 'Merchant', ColumnWidth: manual, Size: 3) {
  filter fltMerchant { textfilter ftMerchant (attribute: Merchant) }
}
```

Four steps of validation agreed the grid-level form was fine, and the only
signal that it was not is that the screen has no search box. The failure mode
this project keeps meeting: **the tool accepting something it does not
implement is worse than rejecting it**, because every check you would run comes
back green.

---

## Phase 15 — OQL statements (2026-08-14)

The runtime can execute OQL `insert`, `update` and `delete`. Studio Pro cannot
author one, and nothing in the model can reach them without a Java action. Three
use cases were built on them — applying the categorisation rules, copying a year
of budgets, and a loader table — and the grammar was mapped by running
statements rather than by reading about them.

### 109. OQL DML is in the public API, and the version it arrived in is the version this app runs

Two calls, both in `com.mendix.public-api.jar`, found with `javap` before any
code was written:

```
com.mendix.core.Core.createOqlStatement(String)  -> OqlStatement
OqlStatement.setVariable(name, value)            -> OqlStatement
OqlStatement.execute(IContext)                   -> int rows affected
```

The [reference guide](https://docs.mendix.com/refguide/oql-statements/) dates
each piece, and the dates matter more than usual here:

| Statement | Available from |
|---|---|
| `DELETE` | 11.1.0 |
| `UPDATE` | 11.3.0 — associations 11.4.0 |
| `INSERT … SELECT` | 11.6.0 — associations 11.7.0 |
| `INSERT … VALUES` | **11.13.0** |

This project is on 11.13.0, so `INSERT … VALUES` works here and would not have
worked one patch release earlier. Anything built on this needs the runtime
version pinned deliberately, not inherited.

Sixteen statements were run through a probe that reports rather than throws.
What parses:

```
update E set col = <literal | expression | $var> where …      OK
update E as t set t.col = …                                    OK   (alias)
update E set Module.E_Assoc = <id | path | null> where …       OK
delete from E where …                                          OK
insert into E (cols) values (…)                                OK
insert into E (cols) select … from …                           OK
where … like '%x%' / in (…) / exists (select …) / id in (…)    OK
select …                                                       ERR  "Unexpected statement type READ"
$var with no setVariable                                       ERR  "No value supplied for the parameter"
```

`select` through the statement API is rejected, which is the right shape: these
are statements, and reads keep going through `retrieveOQLDataTable`.

**The association column must be module-qualified.** `BudgetOverride_Category`
fails with *"Member BudgetOverride_Category of entity Ledger.BudgetOverride not
found"*; `Ledger.BudgetOverride_Category` works. The value is either a path
ending in `/id` or a LONG.

### 110. Two association paths in one select list collide on a column name that is not in the statement

The promote half of the loader — one `insert into Transaction … select … from
ImportRow` — failed with:

```
com.mendix.datastorage.oqltree.AnalysisException: Duplicate column name: ID
```

There is no column called `ID` in the statement. There are two paths that end in
one:

```sql
select …, r/Ledger.ImportRow_Account/Ledger.Account/id,
          r/Ledger.ImportRow_Category/Ledger.Category/id
```

Both arrive named `ID`. The fix is an alias on every column in the list, which
is worth doing from the start rather than when the second association is added:
the error arrives at analysis time, names nothing that appears in the text, and
is identical whichever pair collided.

### 111. An association compared to null in a WHERE matches nothing, and says nothing

This one wrote bad data. The loader resolves an account name into an
association, then rejects the rows where the resolution failed:

```sql
update Ledger.ImportRow set IsValid = false, Problem = 'Unknown account'
where Batch = $b and Ledger.ImportRow_Account = null
```

Six rows in, one deliberately naming an account that does not exist. The
validation reported **one** rejection — the row with a zero amount — and the row
with the unresolvable account was promoted into `Transaction` **with no account
at all**.

Three idioms, same batch, same row, counted by the statement itself:

```
update … where Ledger.ImportRow_Account = null                           rows=0
update … where Ledger.ImportRow/Ledger.ImportRow_Account/…/id = null     rows=0
update … where not exists (select 1 from Ledger.Account as a
                           where UPPER(a.Name) = UPPER(…/AccountName))   rows=1
```

Neither null comparison errors. Neither matches. A validation written that way
passes every row it is given, and the only symptom is that nothing is ever
rejected — which looks exactly like clean input.

With `not exists`, the same batch rejects 2 of 6 and promotes 4, which is the
planted answer.

**Test the source, not the association.** Ask whether a matching row exists in
the table you are resolving against; do not ask whether the association came out
empty.

### 112. A failing after-startup microflow takes the app down and rolls back everything it did

Using the after-startup microflow as a probe harness is a fast loop — no UI, no
clicking, results in the log. It has two properties worth knowing before relying
on it.

The exception from the promote statement above did not just fail that step:

```
ERROR - Core: An exception occurred while running the after-startup-action.
ERROR - M2EE: Starting Mendix Runtime failed.
Caused by: The after-startup-action failed with an exception or returned false.
```

The app did not start at all. And the two budget-copy statements that had
already logged success were gone — 0 rows in the database afterwards. One
transaction wraps the whole action, so a failure at the end silently undoes
everything before it, including the parts whose log lines say they worked.

Both are fine for a probe that catches its own exceptions and reports them as
text. Neither is fine for a probe that lets one throw.

---

### 113. MDL cannot set an OData service's association representation, so every published entity fails CE7375

Publishing an OQL view entity as a read-only OData endpoint — aggregation in the
database, a chart fetching rows already summed — is a supported Mendix
capability. It cannot be authored in MDL today, and the reason is one setting.

The service applies cleanly and fails at build:

```
[error] [CE7375] "Attribute ID for entity 'Ledger.VMonthCategory' must be
published and be the key when associations are exposed as an associated object
id." at Published entity 'VMonthCategory'
```

The entity has no associations. It is a view entity, which cannot carry one
(CE6771, finding 41), and the service sets `PublishAssociations: No`.

**Everything the message suggests is a dead end.** A key of your own does not
satisfy it — a view carrying `cast(c.id as string) as RowId` published as the key,
with `IsPartOfKey` confirmed `true` in the stored model, fails identically, as
does a grouped view keyed on the columns that define its grain. The column cannot
be named `ID` (`CE0174`, `CE7247` — reserved word). The system id cannot be
exposed (`CE1613`). And it is not about view entities: publishing
`Ledger.Category`, a persistent entity that does have an id, fails the same way.

**`PublishAssociations` is not the setting the check reads.** It is stored
correctly — the service's `.mxunit` carries `\x08PublishAssociations\x00\x00`, a
BSON boolean set to false. (An earlier draft of this entry blamed mxcli for
dropping it, inferred from `DESCRIBE` not echoing it back. `DESCRIBE` is lossy
here, the same shape as finding 104, and absence in a description is not evidence
of absence in a model.)

The setting that matters is a different one. Mendix's
[published OData service reference](https://docs.mendix.com/refguide/published-odata-services/)
describes an **Associations** representation choice in the service configuration
— how associations are represented, of which "as an associated object ID" is one
option and the one CE7375 names. That is an enum, not the boolean.

**mxcli has no such property.** Its generated metamodel for
`ODataPublish$PublishedODataService2` binds twenty-one properties and none of
them is the representation:

```
Excluded ExportLevel Namespace Path AllowedModuleRoles ServiceName Entities
EntitySets Microflows Enumerations PublishAssociations Version
AuthenticationMicroflow AuthenticationTypes Summary Description
ReplaceIllegalChars UseGeneralization ODataVersion IncludeMetadataByDefault
SupportsGraphQL
```

And MDL accepts nine service properties, checked by name — an unknown one is
rejected rather than passed through (MDL-ODATA01):

```go
knownODataServiceProps = []string{
    "Path", "Version", "ODataVersion", "Namespace", "ServiceName",
    "Summary", "Description", "PublishAssociations", "Folder",
}
```

So the model takes the default representation, the default is the one that
demands the entity's `ID` as key, and there is no spelling of MDL that says
otherwise.

**What this is, precisely:** not a Mendix limitation and not a bad error message
— a published entity keyed on selected attributes is exactly what the reference
guide describes. It is one property missing from mxcli's OData surface. Setting
the representation once in Studio Pro would unblock the whole path, and adding
the property to `knownODataServiceProps` and the metamodel binding would unblock
it from MDL.

**Published REST is in the grammar** and takes a different shape — resources
mapping HTTP verbs to microflows — so it does not go near CE7375 and is the
likelier route for a chart endpoint today. It was not tested here.

The chart half was verified separately against an endpoint the app serves:
`200`, six marks, no error, `format.property` unwrapping the OData envelope. It
is the publishing half that MDL cannot currently reach.
