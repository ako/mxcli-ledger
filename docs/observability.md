# Runtime observability report

A monitoring pass over the running app, following
[`analyze-runtime.md`](../Ledger/.ai-context/skills/analyze-runtime.md): logs for
errors, Prometheus for database pressure, OpenTelemetry spans for where the time
goes.

| | |
|---|---|
| mxcli | `96f564f6` (2026-08-04) |
| Mendix | 11.12.1 |
| Data | 334 transactions, 13 categories, 2026 |
| Load | one scripted browsing pass over every screen, plus live traffic through the hub preview |
| Collected | 14,396 spans, 8,688 of them JDBC |

How it was collected:

```bash
mxcli run --local --ensure-db --metrics \
  --trace-otlp http://127.0.0.1:4318 --trace-service ledger
```

The bundled OTel agent speaks OTLP protobuf, so the spans were caught by a
~90-line receiver that decodes the wire format and appends one JSON object per
span — see `Errors found in the tooling` below for why `http/json` is not an
option.

---

## Errors

**Server-side: none.** The traced run logged zero `ERROR` lines across the whole
browsing pass. The errors sitting in `runtime.log` are older than the current
code — an after-startup expression failure on 2026-07-28 and a batch of
`Ledger.Dashboard.dvDashSel` / `lvDash` datasource failures on 2026-07-29, none of
which reproduce.

**Client-side: one failed request per page load.**

```
requestfailed :: https://fonts.googleapis.com/css2?family=IBM+Plex+Sans... :: net::ERR_CONNECTION_RESET
```

`theme/web/custom-variables.scss:39` sets `$font-family-import` to a Google Fonts
URL, and Atlas turns that into an `@import url(...)` in `main.scss`. Two
consequences:

- **The design has a hard runtime dependency on an external CDN.** It degrades
  quietly rather than breaking, but in an air-gapped or CDN-blocked deployment
  nobody sees IBM Plex.
- **The screenshots in the README were taken in this container, where that
  request fails.** They show the fallback stack — `ui-monospace`/Menlo for
  figures, Georgia for headings — not the typography the theme specifies. The
  computed `font-family` is right; the faces behind it never arrived.

Self-hosting the three faces under `theme/web/` would fix both. Worth noting the
app itself is fine: a browser outside this container loads the fonts normally.

---

## Where the time goes

Per microflow datasource, with database queries attributed by walking the span
tree (inclusive of nested microflows):

| datasource | calls | mean | p95 | queries/call |
|---|---:|---:|---:|---:|
| `DS_ReportContext` | 4 | 530 ms | 933 ms | **214** |
| `DS_CashflowRows` | 16 | 322 ms | 792 ms | **173** |
| `DS_SunburstLines` | 24 | 206 ms | 590 ms | **118** |
| `DS_SunburstSelection` | 16 | 162 ms | 614 ms | **90** |
| `DS_BudgetRows` | 3 | 88 ms | 127 ms | 28 |
| `DS_SunburstRows` | 16 | 72 ms | 240 ms | 2 |
| `DS_SunburstContext` | 8 | 67 ms | 443 ms | 2 |
| `DS_RulesContext` | 3 | 35 ms | 66 ms | 4 |
| `DS_DrillLines` | 16 | 9 ms | 18 ms | 3 |

One scripted pass over the app — 45 client requests — issued **2,194 SELECTs**.
Nearly all of that is four flows, and every one of them is the same defect.

### 1. `DS_CashflowRows` — 169 identical queries per render

169 of its 173 queries are one statement, repeated:

```sql
SELECT "ledger$categorygroup"."id", "ledger$categorygroup"."name", ... 
```

The cause is a single line — the condition of the loop that matches a view row
back to its `Category`:

```
loop $C in $Cats
  if ($C/Ledger.Category_CategoryGroup/Ledger.CategoryGroup/SortOrder * 100
       + $C/SortOrder) = $V/SortKey then
```

13 category rows × 13 categories = 169 evaluations, and **crossing the
association is not cached across iterations** — each evaluation is its own round
trip, for 13 distinct groups. The flow's own docblock says it "makes two queries
and does the rest in memory"; it makes 173.

Fix: resolve each category's group sort order once, before the outer loop, into a
parallel list — or give `VMatrixActual` a column carrying the category id so the
match needs no loop at all.

### 2. `DS_SunburstLines` — one query per transaction, twice

```
set $CatName = $T/Ledger.Transaction_Category/Ledger.Category/Name;   -- every transaction
set $Acct    = $T/Ledger.Transaction_Account/Ledger.Account/Name;     -- every kept one
```

672 category selects and 180 account selects over 9 invocations. Textbook N+1,
and the category one is worse than it looks: it runs *before* the filter that
discards the row, so transactions that never appear in the output still cost a
query each.

Fix: retrieve the categories and accounts once into lists and match in memory, or
push the filter into `GET_SunburstTransactions` so the loop only sees rows it will
keep. `DS_SunburstSelection` (90 queries/call) shares the same helper and gets
well by the same change.

### 3. `DS_ReportContext` — 416 aggregates for a header

The KPI strip calls `CALC_Actual` and `CALC_Budget` once per category per month —
208 calls each in this sample, every one its own `AggregateUsingDatabase`. At
530 ms mean and 933 ms p95 this is the slowest single datasource in the app,
and it is computing totals that `VMatrixActual` already has.

Fix: sum the view rows the matrix already retrieves instead of re-aggregating per
cell.

### Steady state

With nobody browsing, the app still issues **177 SELECTs/minute**, all of them:

```sql
SELECT "system$queuedtask"."id", "system$queuedtask"."sequence", ...
```

That is the task-queue poller — three queues (`MendixWorkflows-WorkflowExecution`,
`MendixWorkflows-DefaultTaskExecution`, `ScheduledEventsQueue`) polling about once
a second each. This app defines no workflows and no scheduled events, so it is
pure overhead. It belongs to no microflow, which is why it is invisible from any
per-flow view and shows up only in the raw span stream.

### Page timings

Measured browser-side, click to content:

| | cold | warm |
|---|---:|---:|
| First load (client bundle) | 16.9 s | — |
| Dashboard | 16.9 s | 268 ms |
| Cashflow | 2.4 s | 1.4 s |
| Budgets | 427 ms | — |
| Transactions | 2.5 s | — |
| Accounts | 2.0 s | — |
| Categories & rules | 3.0 s | — |
| Dashboard ring click | see below | |
| Cashflow cell click | see below | |

Cashflow stays slow warm because `DS_CashflowRows` re-runs in full on every
visit. The others are cheap once the client bundle is cached.

The click figures in the first version of this table were wrong — they measured
a fixed `waitForTimeout(1500)` in the load script rather than the click. What a
click actually costs is measured below.

---

## After the fix

All four were fixed and the identical scripted pass re-run.

| | before | after |
|---|---:|---:|
| **SELECTs for one 45-request pass** | **2,194** | **225** |
| `DS_ReportContext` | 214 q/call, 530 ms | 3 q/call, 124 ms |
| `DS_CashflowRows` | 173 q/call, 322 ms | 4 q/call, 278 ms |
| `DS_SunburstLines` | 118 q/call, 206 ms | 1 q/call, 65 ms |
| `DS_SunburstSelection` | 90 q/call, 162 ms | 2 q/call, 59 ms |
| Cashflow page, warm | 1,372 ms | 657 ms |

What changed:

- **`VTransactionLine`** — a new view joining Transaction → Category → Group →
  Account, with mirrors excluded. `GET_SunburstTransactions` returns these
  instead of `Transaction`, so `DS_SunburstLines` reads plain columns where it
  used to cross two associations per row.
- **`DS_ReportContext`** now reads `VMatrixActual` and `VCategoryBudget` — the
  same two views the matrix reads — instead of calling `CALC_Actual` and
  `CALC_Budget` per category per month.
- **`DS_CashflowRows`** matches a view row to its Category on `Name = Label`
  rather than recomputing the view's `SortKey` from the association.
- Both category lookups became `find($List, key = …)` on the advice of
  **MDL001**, which the linter raised on exactly these two nested loops.

`DS_ReportContext` moved from `08-cashflow-datasources.mdl` to
`10-cashflow-view.mdl`, because it now depends on view entities defined there
and the files apply in order.

A second pass then re-keyed both drilldowns on `cast(id as string)` (finding
74), taking the pass from 225 SELECTs to **173** and the warm Cashflow page from
657 ms to **340 ms**: `DS_CashflowRows` no longer
retrieves all thirteen categories to name-match one, and `DS_DrillLines` reads
the account name off the view instead of crossing an association per row. Two
associations went with it — `CashflowRow_Category` and
`ReportContext_DrillCategory` — and `VTransactionLine` moved to
`06a-shared-views.mdl`, since the inspector reads it too. The drill file is now
`10a-cashflow-drill.mdl`: it depends on the views, so it has to apply after
them.

### Verified, not assumed

The figures have to be identical, and they are — checked along three
independent paths:

| | value |
|---|---|
| Cashflow INCOME / SPEND / NET | € 45,118 / € 29,566 / € 15,552 |
| Postgres, same window, straight SQL | Income 45,118 / Expense 29,566 |
| Dashboard total (merchant view) | € 29,566 |
| Groceries, dashboard vs matrix | € 4,484 both |
| Albert Heijn drilldown | € 1,124 · 19 transactions, 19 lines rendered |

The KPI flow now computes its totals from a completely different query than
before and lands on the same numbers as raw SQL. `mx check`: 0 errors.

### What did not improve, and why

`DS_CashflowRows` lost 169 queries and got only ~60 ms faster. That is the
expected result once measured rather than assumed: against a loopback Postgres
those queries cost ~0.4 ms each, so they were ~20% of the flow's time. The rest
is interpreter overhead — the flow makes roughly 3,000 nested microflow calls
per render (`GET_ViewBudget` alone runs 468 times) and 1,611 Change activities.

The fix is still worth it, because the cost it removes is the one that scales:
169 round trips against a database 1.5 ms away is ~250 ms, and 169 connections
held per concurrent user is a pool problem. But if this page needs to get
genuinely fast, the next target is the per-cell microflow calls, not the SQL.

## Still open: selecting a cell rebuilds the whole matrix

Clicking a cashflow cell fires **three** requests, not one:

| request | cost |
|---|---:|
| `ACT_DrillCell` | 15–62 ms |
| **`DS_CashflowRows`** | **131–374 ms** |
| `DS_DrillLines` | 14–71 ms |

The detail list is not the slow part. The matrix — all 228 cells, ~3,000 nested
microflow calls — is rebuilt on every selection, and the grid re-renders with
it. Through the hub tunnel each request also costs a round trip (~150 ms
measured), so it is paid twice.

The cause is one line in `DS_CashflowRows`:

```
if $V/SortKey = $Context/DrillSortKey and $M = $Context/DrillMonthIndex then
  set $Band = $Band + ' cf-sel';
```

The selection outline is **baked into the row data**, so `ACT_DrillCell` has to
refresh the `ReportContext` — and because the grid's datasource and the
inspector's list both take that same object as their parameter, refreshing it to
update the list unavoidably invalidates the matrix. The matrix is rebuilt to
move one CSS class.

### The fix, and why it is not in yet

Split the drill state onto its own non-persistent object associated to the row.
`ACT_DrillCell` then refreshes only that, `DS_CashflowRows` never re-runs, and
the outline moves into the column's `DynamicCellClass` expression reading the
selection through a single association hop.

The open question is whether DataGrid2 re-evaluates a cell-class expression when
an *associated* object refreshes. It could not be probed cheaply:
`ALTER PAGE … ON colM03` fails with `widget "colM03" not found`, because grid
columns are not addressable as widgets, so testing it means rewriting the page
in source and restarting.

There is a cleaner version of this that needs no split at all, and it is blocked
on finding 75. A view keyed on `(CategoryId, Yr, MonthIndex)` works — `datepart`
gives integer year and month columns, and OQL builds the meta line exactly
(`17 Mar · ING Betaalrekening`). If the list could be a plain database
datasource over that view, nothing would take the `ReportContext` as a
parameter and the rebuild would disappear as a side effect. The one column that
stops it is the amount: OQL cannot produce `#,##0.00` — it has no `substring`,
`abs` or `floor` (CE0174) — and MDL cannot ask the Text widget to format it.
Give `contentparams` a `Format` slot and this whole section becomes moot.

## Errors found in the tooling

Two mxcli issues surfaced while doing this; both are recorded in
[`FINDINGS.md`](../FINDINGS.md) as 70 and 71.

- **`--trace-otlp` reports success when the agent died.** Setting
  `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` (which the skill invites, since it says
  user-set `OTEL_*` wins) makes the bundled agent abort at boot with
  `Unsupported OTLP traces protocol: http/json`. mxcli still prints
  *"Tracing enabled … spans → OTLP"* and the app starts normally. The failure is
  visible only by grepping `runtime.log`, and the symptom is simply no spans.
- **The metric names in the skill do not match the ones served.** Documented as
  `connectionbus_{selects,…}_total`; actually
  `mx_runtime_stats_connectionbus_selects_total`.

---

## Reproducing

```bash
# terminal 1 — span receiver (protobuf, no deps)
node otlp-receiver.js spans.jsonl

# terminal 2
mxcli run --local --ensure-db --metrics --trace-otlp http://127.0.0.1:4318

# database pressure, live
watch -n5 'curl -s localhost:8090/prometheus | grep mx_runtime_stats_connectionbus'
```

Two gotchas worth carrying forward:

- `jvm_memory_used_bytes` carries an `id` label containing spaces
  (`id="G1 Eden Space"`), so the value is awk's `$NF`, not `$2`. Summing `$2`
  silently yields zero.
- The span stream includes *all* traffic, including anyone else on the hub
  preview. A "quiet" window that shows 1,241 selects/minute may just mean someone
  is using the app — check `handler_requests_total{name="xas/"}` before
  concluding the app is churning on its own.
