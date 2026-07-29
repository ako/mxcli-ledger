# Ledger prototype — analysis and Mendix mapping

Source: `Ledger.dc.html` + `support.js` (Claude artifact export, 2026-07-28).
`support.js` is the generic artifact runtime and contains no application code —
everything is in the `<script type="text/x-dc">` block at the end of the HTML.

## 1. What the prototype is

A household-finance app, Dutch/EUR context. Six screens off a dark sidebar,
driven by one `state` object:

| Screen | Purpose |
|---|---|
| Cashflow | Category × month matrix, 6 months, Actual/Budget/Variance modes, heatmap cells, click-to-drill inspector |
| Budgets | Same matrix, editable, per-cell budget overrides |
| Transactions | Search + account/category filters, "needs review" toggle, inline category assignment |
| Import | Three-step CSV wizard |
| Categories & rules | Two-level taxonomy + ordered rule list |
| Accounts | Four account cards with balance and delta |

### Seed data (hardcoded constants)

- `MONTHS` — 6 fixed months, `2026-02` … `2026-07`, each with a `days` count used
  by the generator (the Mendix app widens this to a full calendar year — see §3)
- `ACCOUNTS` — 4 (ING Betaalrekening, ING Spaarrekening, ABN AMRO Creditcard, Revolut)
- `GROUPS` — 5 (Income, Housing, Daily living, Lifestyle, Financial), each `income` or `expense`
- `CATS` — 13 categories, each with a baseline monthly budget, a merchant list, and eligible accounts
- `BUDGET_OVERRIDES` — 5 per-category-per-month overrides
- `RULES` — 8 categorisation rules
- `IMPORT_HISTORY`, `CSV_COLS`, `CSV_ROWS` — import screen fixtures

Transactions are **generated in the constructor by a seeded LCG PRNG**
(`s = 20260726`), yielding ~200 categorised transactions plus **12 deliberately
uncategorised** ones. No persistence, no backend — a reload regenerates identical
data.

## 2. Real logic vs. façade

Roughly half of what the UI implies is not implemented. This drives the estimate.

### Genuinely implemented

- `budgetOf()` — override resolution: session edit → `BUDGET_OVERRIDES` → category baseline
- `actualOf()` — sums transactions per category per month, excluding mirrors
- `tint()` — variance → heatmap colour, with a 2% dead band and a `varianceStrength` prop
- `buildMatrix()` — group subtotals, category rows, row/column totals, net-cashflow row
- Transaction filtering (search, account, category, uncategorised-only) and the 40-row cap
- KPI rollups (income, spend, net, over-budget cell count)
- Cell → transaction drilldown

### Decorative only

1. **The rules engine never executes.** `RULES` is a static display list. Categories
   come from the generator, not from rule evaluation. The "N matched" counter counts
   transactions whose *seeded* category equals the rule's category — it does not
   evaluate the rule's condition. Rule 8 is not well-formed data at all:
   `{field:'amount', op:'= −700,00', value:'and merchant Spaarrekening'}` is a
   display sentence, not an evaluable condition.
2. **Import reads no file.** `pickFile`/`runImport` only advance `importStep`. The
   column mapping and 5 preview rows are constants. "Import 142 rows" and
   "Review 16 uncategorised" are hardcoded and inconsistent with the 12
   uncategorised transactions actually seeded.
3. "+ New category" has no handler; "+ Add rule" (`addRule`) re-navigates to the
   same screen.
4. ⌘1/⌘2 hints are rendered but no key handler exists.
5. Account `balance`, `delta`, and `lastImport` are static constants, unrelated to
   the transactions.

**Consequence:** the rules engine and CSV import are net-new design work, not a
port. They are also the two things a real ledger depends on.

## 3. Decisions taken

- **Visual fidelity: close but Atlas-native.** Keep the layout, the matrix and the
  heatmap concept; express them in Atlas defaults with light theming rather than
  reproducing the bespoke IBM Plex / warm-paper / dark-sidebar design system.
- **Rules and import: build both for real.** Ordered rules with first-match-wins
  evaluation applied on import, and real CSV parsing with duplicate detection.
- **Window: 12 months, calendar year 2026.** Widened from the prototype's 6.
  Actuals are seeded January–July (today is 2026-07-28); August–December carry
  budgets but no actuals. This is how a household budget app actually behaves, and
  it gives Budget and Variance modes a purpose beyond restating Actual. Note 2026
  is not a leap year, so February has 28 days.

## 4. Domain model

Persistent:

| Entity | Key attributes | Associations |
|---|---|---|
| `Account` | Name, IBAN, Type (enum Checking/Savings/Credit), Balance, LastImport | |
| `CategoryGroup` | Name, Type (enum Income/Expense), Color, SortOrder | |
| `Category` | Name, BaselineBudget, SortOrder | → CategoryGroup |
| `BudgetOverride` | MonthKey (`YYYY-MM`), Amount | → Category |
| `Transaction` | Date, Merchant, Description, Amount, Signed, IsMirror | → Account, → Category (empty = uncategorised) |
| `CategoryRule` | SortOrder, Field (enum), Operator (enum), Value | → Category |
| `ImportBatch` | FileName, ImportedOn, NewCount, DupeCount | → Account |

Non-persistent (report scaffolding):

| Entity | Purpose |
|---|---|
| `ReportContext` | screen, mode (Actual/Budget/Variance), drill category + month, filters, search |
| `CashflowRow` | one matrix row: label, row kind (group/category/net), row total |
| `CashflowCell` | one cell: amount, variance band, `IsElapsed` flag, target category + month for drilldown |

Notes:

- `BudgetOverride` covers both the seeded `BUDGET_OVERRIDES` and the prototype's
  session-only `budgetEdits` — one entity, no distinction needed.
- `IsMirror` matters: the savings category emits a paired transaction on the
  savings account so balances work, and `actualOf()` excludes it from category
  totals. Without the flag, savings transfers get double-counted.

## 5. Risks and design decisions

### 5.1 The pivot matrix is the bulk of the work

**Superseded in part (2026-07-29).** The row *assembly* described below was
replaced by two view entities — see FINDINGS 36-38. OQL supports `UNION ALL`,
and `datepart()` reads the month straight off `TxDate`, so the figures now come
from two queries instead of ~936 retrieves. The DataGrid2 rendering below is
unchanged and still correct.

MDL/Mendix `datagrid` columns are declared statically, so a category × month pivot
is not native. It is tractable **only because the window is a fixed width** — 12
months, per §3: build a non-persistent `CashflowRow` with twelve `CashflowCell`
references and render it as a gallery/listview whose template contains twelve cell
containers. Width being *fixed* is what matters, not it being small; going from 6
to 12 doubles the boilerplate but introduces no new technique.

Verified as supported in MDL (`mdl-examples/doctype-tests/`):

- `container x (dynamicclasses: 'if ... then ''a'' else ''b''')` — per-cell styling
- `container x (onclick: microflow Module.MF, class: '...')` — per-cell drilldown
- `gallery x (datasource: ..., DesktopColumns: N) { template t { ... } }`

**If the month window ever becomes variable-length, this design breaks** and the
matrix needs a pluggable widget. Twelve is the committed width.

At 12 months the table is 14 columns (category label + 12 months + row total).
The prototype sets `min-width: 700px` for 6 months; 12 puts it near 1300–1400px.
The matrix needs a horizontal scroll container with the category label column
pinned, or it is unusable on anything but a wide desktop. This is a new problem
that did not exist at 6 months.

### 5.2 The heatmap must be banded

`tint()` computes a continuous alpha:
`rgba(168,50,30,` + `(0.06 + ratio*0.32) * strength` + `)`. Mendix supplies class
names, not computed colours, so this becomes ~10 discrete bands
(`over-1`…`over-5`, `under-1`…`under-5`) in SCSS, selected by a
`dynamicclasses` expression over the variance ratio. Visually near-identical, not
identical. The 2% dead band and the income/expense sign flip carry over unchanged.

### 5.3 Future months must be suppressed, not zero

A consequence of the calendar-year window that is easy to miss and would silently
corrupt the report.

August–December have budgets but no actuals. If those cells fall through the
normal path they compute `actual = 0`, and `tint()` reads a zero actual against a
full budget as **maximally under budget** — so the entire second half of the year
paints deep green and the app reports five months of imaginary savings. The same
zero flows into the KPI rollups (`income`, `spend`, `overCount`) and the
net-cashflow row.

Required handling, driven by an `IsElapsed` flag on `CashflowCell`:

- **Actual mode** — future cells render empty, not `€ 0`, and are never tinted.
- **Variance mode** — future cells render empty; variance against a month that has
  not happened is meaningless.
- **Budget mode** — future cells render normally. This is the mode where
  August–December are genuinely useful, and the main reason for choosing a
  calendar year over a rolling window.
- **Net cashflow row** — elapsed months only. A projected net from budgets is a
  different feature; do not conflate it with actuals.
- **KPI rollups and `overCount`** — elapsed months only.
- **Row totals** — sum actuals over elapsed months, budgets over all twelve. These
  two totals are no longer comparable, so the Actual/Budget/Variance mode must
  drive which total is shown (the prototype already does this in `buildMatrix()`).

`IsElapsed` should be derived from the current date at row-build time, not
hardcoded to July, so the app stays correct as 2026 progresses.

### 5.4 Inline cell editing

**Settled (2026-07-29): a per-cell popup.**

The prototype commits on Enter, cancels on Escape, and commits on blur.
Reproducing that exactly in Mendix is fiddly and buys little; the popup is
unambiguous about what is being edited and has room to show the category
baseline and offer a reset, which the inline version could not.

The Dutch number parsing in `commitBudget()` (`1.480,00` → strip `.`, `,` → `.`)
is not reimplemented: the amount is a Decimal bound to a normal input, so Mendix
parses it per the user's locale. That is the same job, done by the platform.

Two behaviours worth keeping in mind:

- Saving an amount equal to the category baseline **removes** the override
  rather than storing a redundant one. An override equal to the baseline would
  mark the cell as a deviation when nothing deviated.
- The grid updates in place. A microflow datasource is not invalidated by
  committing what it reads, so the popup carries a reference back to its row and
  the save rebuilds that one row and refreshes it in the client — see FINDINGS
  44 for why the obvious alternative (re-navigating to the page) was rejected.

### 5.5 Real CSV import

New work: FileDocument upload, Dutch parsing (`DD-MM-YYYY`, comma decimals, an
`Af`/`Bij` direction column rather than a signed amount), duplicate detection on
date + amount + account, then rule evaluation over the new rows.

### 5.6 Real rules engine

Needs a proper operator model: `contains`, `starts with`, `is one of` over merchant
or description, plus an amount comparison. Rule 8 in the prototype must be
redesigned — a rule with both an amount and a merchant condition implies either
multiple conditions per rule or a compound-condition entity. Simplest workable
model: ordered rules, first match wins, one field/operator/value per rule, and
split rule 8 into a dedicated savings-transfer rule.

## 6. Suggested phasing

1. **Foundation** — domain model, enumerations, seed/demo-data microflow,
   Transactions + Accounts + Categories screens. Mostly native Mendix.
2. **Cashflow + Budgets** — the pivot matrix, variance modes, heatmap bands,
   drilldown, budget overrides. The hard, distinctive part.
3. **Rules + Import** — real rule evaluation and real CSV ingestion.

Each phase is authored as numbered `.mdl` files under `<App>/mdlsource/` and
re-applied from scratch, per the ground rules in `TOOLING.md`.
