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

### 76. mxcli PR #88 tested — the format block is written correctly and has no runtime effect

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

Two smaller things from the same test run:

- **The PR does not build as pushed.** It changes `mdl/grammar/domains/MDLPage.g4`
  without the regenerated parser, so `go build ./cmd/mxcli` fails with
  `paCtx.ParamFormatV3 undefined` / `undefined: parser.IParamFormatV3Context`
  until `make grammar` is run.
- **MDL-WIDGET18's suggested fix does not parse.** It advises
  `ContentParams: [{1} = Attr (decimalprecision: <value>)]`, omitting the
  `format` keyword the PR's own documentation calls required. Copy-pasting the
  suggestion gives a syntax error; `{1} = Attr format (…)` is correct.
