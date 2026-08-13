# Ledger

A household-finance app for Mendix 11.13.0, authored **entirely through
[mxcli](https://github.com/ako/mxcli) and MDL**. No hand-edited `.mpr`, no Studio
Pro. Every entity, microflow, page and theme token in this repository was written
as MDL source and applied from the command line.

It began as a [Claude artifact prototype](./PROTOTYPE-ANALYSIS.md) and was
rebuilt slice by slice, each one verified by running the app and reading the
figures back out of it.

The second deliverable is [`FINDINGS.md`](./FINDINGS.md) — 99 numbered entries
recording every mxcli bug, surprise and workaround found along the way, with the
exact command and output. Several have since been fixed upstream; the file
records which, and how they were verified.

---

## The app

### Dashboard

One chart. One row per category, and in that row the four things you would
otherwise open four screens to compare.

![Dashboard](docs/screenshots/dashboard.png)

A net strip across the top — income above the axis, spend below, net through
the middle, twenty months. Then the table: each category's own twenty months
against the band it usually occupies, this year against the same months of last
year as a bar either side of zero, the year's total direct-labelled, and how
much of it is standing cost. Clicking a row lists what is behind it.

The readings are meant to be made in that order and to lead somewhere. A red
dot is a month more than two deviations above that category's own normal:
six of them over 280 category-months, which is about the rate at which a mark
still means "open this". At one deviation it fired on one month in six and was
decoration. The delta bars are coloured by *favourable* rather than by sign, so
income falling and spend rising are both red — Freelance is down € 1,505 on
last year, Rent up € 590. The recurring column is the saving column: a merchant
billing in four months or more is a standing cost, and the filled part of the
bar is the part cancelling actually removes. Income rows are blank there, which
is the honest reading — there is no standing cost to cancel in a salary.

**Uncategorised transactions are a row in the table, not a badge in a corner.**
They get the same four readings as anything else, they sort in with everything
else, and a row cannot be dismissed the way a number off to one side can. Today
that row reads € 764 across twelve transactions, all in one month — which is
why it renders as a point rather than a line.

Clicking a row opens what is behind it — every transaction in that category,
against a scale that starts where the data does rather than at zero, because
zero is not a value any grocery shop ever charged:

![Dashboard detail](docs/screenshots/dashboard-detail.png)

Every figure was read back out of Postgres: Salary € 43,661, Rent € 11,813,
Freelance € 7,520, down to Subscriptions € 514 and the € 764 review row, all
fourteen matching the rendered column exactly. Groceries reports € 11,783 over
220 transactions, largest 40 plotted — also the figure in the panel above.

This replaced a sunburst and a sankey, both Plotly through the CustomChart
escape hatch. Each answered one question and neither answered it densely — a
donut spent a screen on thirteen numbers, a sankey spent one on about twenty,
and both were shape-first: you read the picture, then went hunting for the
figure. Neither showed a trend, an outlier, or anything you could act on.

The replacement is Vega-Lite through the project's own widget, and the whole
table is one spec: an `hconcat` of four faceted panels sharing a row order,
because Vega-Lite cannot put a concatenation *inside* a facet. Panels that must
align is the fragile part of that arrangement, and two ways of breaking it are
in finding 94 — facet rows default to sizing themselves to their content, and a
transform that aggregates away the sort field drops one panel back to
alphabetical order while the others hold. Both were found by rendering the spec
headless in node and reading the row geometry off the scenegraph, which turns a
three-minute deploy into a three-second check.

### Cashflow

Thirteen categories by twelve months, with group subtotals and a net line, in
three modes. The heatmap shades each cell by how far it ran over or under its
monthly budget. Clicking a category cell points the inspector at its
transactions.

![Cashflow](docs/screenshots/cashflow.png)

Variance mode flips the sign for income rows — being *under* on income is the
unfavourable direction:

![Cashflow in variance mode](docs/screenshots/cashflow-variance.png)

Months with no data are blank rather than zero. A zero actual against a full
budget would read as maximally under budget and paint the rest of the year
green — see [§5.3 of the analysis](./PROTOTYPE-ANALYSIS.md). "No data" is not
the same as "in the future": bank data arrives in arrears, so the window is the
earlier of months elapsed and months with any activity (finding 83).

Below the matrix, the same thirteen categories as a small-multiple grid — a
twelve-month line over its budget envelope, with over-budget months marked:

![Cashflow sparklines](docs/screenshots/cashflow-sparklines.png)

This one is not Plotly. It is Vega-Lite through
[`widgets-src/vegachart`](./widgets-src/vegachart), a pluggable widget built for
this project, and it is here because `facet` is an operator: the grid falls out
of the data instead of being thirteen hand-placed subplots. The widget takes the
**spec and the data separately** — the spec is a static property, committed and
diffable, and the microflow emits only a table of rows. Nothing assembles a
chart payload at runtime, which is the opposite of how the Plotly charts it
replaced were built. `vega-embed` dispatches on the spec's own `$schema`, so full Vega is
reachable through the same widget for what Vega-Lite cannot express.

Drawing the same numbers more densely is also what exposed finding 83: `€ 0` in
a narrow column had been skimmed past for weeks; thirteen lines diving to the
axis was visible immediately.

### Insights

Six charts over one datasource, all Vega-Lite through the project's own widget.
The page reads two years: 2025 in full and 2026 to date.

![Insights filter](docs/screenshots/insights-filter.png)

One filter drives all six: a period, a category and an account. The controls
write to the same object the charts read, so applying a change is one microflow
and one `change … refresh` rather than six datasources re-running independently
— which also sidesteps the datasource-refresh problem in finding 68. Filtering
to Groceries takes the scatter from 820 points to 211, matching SQL exactly.

**The filter is applied by the database, not by the model.** Every retrieve on
this page carries its constraint — the period as an XPath range over a
`MonthKey` column the views compute, the category and account as
`($Var = '' or Column = $Var)`, which lets one retrieve serve both the filtered
and the unfiltered case without branching. The page used to pull every row of
five views and discard most of them in a loop, once per chart.

The year-over-year comparison is now a view rather than a microflow. It was the
most expensive flow on the page and the only quadratic one — an outer pass per
category, an inner pass over every row to total it, and a delimited string
standing in for a set. Conditional aggregation does it in one grouped scan, and
the month window it compares over derives from the data itself through nested
scalar subqueries, so nothing has to pass it a boundary. It carries two
aggregation grains in a `UNION ALL` — one row per category, or one per category
per account — because an account filter changes what a row *is*, and a view
takes no parameters; the caller constrains on the grain and the database prunes
the branch it did not ask for before touching a table (finding 97).

One builder kept its grouping, and the reason is the boundary of the technique:
the standing-costs chart counts distinct months *within the selected period*, so
its aggregate depends on a window chosen at runtime. A view can offer a menu of
grains, not a function of one.

The period rounds outward to whole months for the monthly charts and is exact
for the day-level ones, because the aggregate views are grouped by month.

**Income against spend.** Income stacks above the axis, spend below, and the
dark line is the net — where it sits above zero, the month paid for itself.

![Stream graph](docs/screenshots/insights-stream.png)

**Every expense, over time**, on a log scale so a € 5 coffee and € 1,500 of rent
can share an axis. The flat band near the top is rent; the one along the bottom
is subscriptions.

![Scatter](docs/screenshots/insights-scatter.png)

**Spend by day** — a row per year, a column per week, a cell per day. The empty
cells are days nothing was spent at all, which a monthly total cannot show you.

![Calendar heatmap](docs/screenshots/insights-calendar.png)

**Standing costs**, ranked by monthly average projected over a year. Merchants
billing in fewer than four months are excluded: a single large purchase is not a
saving opportunity however big it was. Savings transfers are excluded too —
they are booked as expenses everywhere else in this app, correctly, but
cancelling one saves nothing.

![Standing costs](docs/screenshots/insights-savings.png)

**This year against last**, over the same months of both years so a partial year
is not compared against a whole one. Colour reads favourability rather than
direction, which is not the same thing for income as for spend.

![Year over year](docs/screenshots/insights-yoy.png)

**Transactions unlike the rest of their category** — each compared against its
own category's mean rather than a global one, since € 1,500 is unremarkable for
Rent and extraordinary for Coffee.

![Outliers](docs/screenshots/insights-outliers.png)

The last two charts read the *same dataset*. The scatter is every expense over
time; the outlier view is the same points with the ones unlike their neighbours
called out, and the calling-out is a `joinaggregate` in the spec — not a second
query, not a second microflow. That is the argument for a grammar over a chart
library, in one line.

#### Two kinds of interaction

The charts respond to a drag and to a click, and the two work in completely
different ways — which is the more interesting half of the story.

**Brushing costs nothing.** Drag across the dates on the scatter and the bars
beneath it re-total to that range:

![Brushing the scatter](docs/screenshots/insights-brush.png)

Measured: 568 of 820 points dim, and **zero server calls** during the drag. The
rows are already in the browser, so a range is a `param` and a `filter` — no
query, no microflow, no round trip. Both views have to live in one spec, though:
a Vega-Lite selection is scoped to its own view, so six separate widgets cannot
share a brush without signalling between them by hand.

**Clicking has to leave the browser**, because the answer is not in the payload.
Clicking a calendar day asks which merchants made up that day's total, and the
calendar only carries a date and a sum:

![Clicking a day](docs/screenshots/insights-dayclick.png)

The widget writes the clicked datum as JSON, a microflow reads a field out of it
and builds the panel. 10 August 2026 returns three transactions totalling
€ 2,409.16 — exactly what Postgres reports for that day.

Getting that round trip exact took finding 92: a clicked mark's datum is an
output of the rendering pipeline, not an echo of what was sent. Temporal fields
come back as epoch milliseconds, and an aggregated mark carries only the fields
the spec groups by — so the date has to be carried a second time, as a plain
string the spec references but never parses.

### Budgets

The same matrix, editable. Click a cell to set that month's budget; months that
override the category baseline are marked.

![Budgets](docs/screenshots/budgets.png)

![Editing a budget cell](docs/screenshots/budget-edit.png)

Saving an amount equal to the category baseline **removes** the override rather
than storing a redundant one — an override equal to the baseline would mark the
cell as a deviation when nothing deviated.

### Categories & rules

Ordered categorisation rules, first match wins, over transactions that have no
category yet. A rule never overwrites a category assigned by hand.

![Categories and rules](docs/screenshots/rules.png)

The panel says what a run *would* do before it does it, using the same evaluation
the run uses. `Categorised` is derived from the data after every run rather than
incremented, so it cannot drift.

### Transactions

![Transactions](docs/screenshots/transactions.png)

Dates and amounts render through **dynamic-text columns** — `ShowContentAs:
dynamicText` with a per-parameter `format (…)` block — rather than plain
attribute columns, which have no formatting options and would show `-21.4` and
the browser's locale date. This is the one screen that does not preformat in a
microflow; the capability came from mxcli PR #88, prompted by findings 75–78.

---

## How it is built

MDL source lives in [`Ledger/mdlsource/`](./Ledger/mdlsource), numbered so the
files apply in dependency order:

| Files | Slice |
|---|---|
| `01`–`04` | Domain model, enumerations, demo data |
| `05` | Transactions, Accounts, Categories screens |
| `06`–`11` | Cashflow matrix, shared views, inspector |
| `12`–`16` | Budgets, per-cell overrides |
| `17`–`19` | Rules engine |
| `20`–`21a` | The sunburst and sankey the dashboard used to show — now orphaned |
| `21b`–`22` | Dashboard: the overview table and what is behind a row |
| `23` | Cashflow sparkline grid, through the project's own Vega widget |
| `24`–`26` | Insights: aggregate views (including the two-grain year-over-year), payloads, six charts |
| `27` | Navigation — the single owner of the menu, applied last |

A runtime monitoring pass — what the app actually does under load, and the four
N+1 datasources it found and fixed (2,194 SELECTs per pass down to 173) — is in
[`docs/observability.md`](./docs/observability.md).

Drilldowns are keyed on `cast(id as string)` rather than on display names. A
view entity cannot carry an association, but it can expose an id, and a view
constrained on that column returns exactly what an association join returns —
so the cashflow inspector reaches its rows without ever holding the object. See
finding 74.

The set is **re-applied from scratch** rather than patched, so the numbering is
the build order and every file is idempotent (`create or modify` throughout).

```bash
cd Ledger
mxcli widget init -p Ledger.mpr                          # required first — see below
for f in mdlsource/*.mdl; do mxcli exec "$f" -p Ledger.mpr; done
~/.mxcli/mxbuild/11.13.0/modeler/mx check Ledger.mpr     # the authority
mxcli test tests/*.test.mdl -p Ledger.mpr --local        # microflow tests
mxcli run --local --ensure-db                            # run it
```

Three rules learned the hard way and worth stating up front:

- **`mxcli check` is a syntax and reference gate; `mx check` is the authority.**
  Several defects in `FINDINGS.md` pass the first and fail the second, and a
  couple pass both and only show up at runtime.
- **`DESCRIBE` is how you find out what was actually serialized.** More than one
  finding came from comparing authored MDL against what came back.
- **`mxcli widget init` is a build step, not a setup step.** mxcli writes a
  widget instance from a definition cached under `Ledger/.mxcli/`, which is
  gitignored and does not refresh when a `.mpk` changes. Skip it after a package
  upgrade and every Data Grid 2 the set authors describes a widget that no
  longer exists — six CE0463 errors, with nothing before `mx check` to say so.
  See finding 87.

### Toolchain

[`scripts/setup-tools.sh`](./scripts/setup-tools.sh) builds mxcli from source,
pins ANTLR, and pre-caches the Mendix engine and runtime. It is idempotent and
detect-then-install, so it is safe on every session start — cold 1m42s, warm
1.4s. [`TOOLING.md`](./TOOLING.md) documents the environment and the ground
rules.

### Theme

The prototype's design system — warm paper, flat hair-ruled cards, a dark
sidebar, IBM Plex, monospace figures — is reproduced by overriding **Atlas'
own custom properties** in `Ledger/theme/web/custom-variables.scss` rather than
by restyling widgets. Every control stays a stock Atlas control and keeps its
states, focus rings and dark-mode handling. Only the handful of things Atlas has
no token for live in `Ledger/themesource/ledger/web/main.scss`.

Monospace on every number is the largest single fidelity win, and it is not
decoration: a fourteen-column matrix of currency only scans if the digits line
up.

The sidebar collapses to a 52px icon rail and opens to the prototype's 224px:

| collapsed | open |
|---|---|
| ![Sidebar collapsed](docs/screenshots/sidebar-collapsed.png) | ![Sidebar open](docs/screenshots/sidebar-open.png) |

It did not, for a while, and the reason is a good illustration of what token
overrides cost: the closed width had been pinned to the open one back when the
menu had no icons, and once icons arrived Atlas' own rule — which gives the
glyph `flex-basis: var(--closed-sidebar-width)` — turned that into a 224px icon
slot that pushed every caption out of view. Finding 95 has the measurements.

---

## Known gaps

Stated rather than hidden:

- **Three of the seven menu icons are not the ones Studio Pro had.** MDL's
  `ICON` reaches icon-collection icons only; the Accounts item carried a glyph
  icon and Categories & rules an image icon, neither of which is authorable.
  Both were placeholders, so file 27 authors collection icons in their place
  and the whole set is reproducible again. `DESCRIBE` now names what it cannot
  carry instead of dropping it silently — see finding 81, which is how the icons
  came to be understood at all. The third, Transactions, was carried faithfully
  and still had to be replaced: it pointed at `Atlas_Styling`, a collection
  whose CSS prefix Atlas' own navigation rules do not match — see finding 95.
- **The chart itself is not clickable.** Three independent blockers, all recorded
  in `FINDINGS.md` 67–69: MDL silently drops an `action`-typed property on a
  pluggable widget; writing a widget attribute does not re-run a datasource over
  its object; and CustomChart forwards the clicked segment's *bounding box*
  rather than the point. The drilldown works through the breakdown list beside
  the chart instead.
- **The dashboard breakdown pages at 20 rows.** `PageSize` on the listview did
  not take effect, so deeper groups need paging to reach.
- **CSV import is not built.** The prototype's import wizard read no file and its
  counts were hardcoded; a real one is genuinely new work.
- **The theme pulls IBM Plex from Google Fonts at runtime.** Where that CDN is
  unreachable the app silently falls back to system faces — including in the
  container these screenshots were taken in, so the images above do not show the
  intended typography. Self-hosting the faces would fix both.

## Layout

```
FINDINGS.md              99 numbered findings — the main deliverable alongside the app
PROTOTYPE-ANALYSIS.md    what the prototype did, what was real, what was decided
TOOLING.md               environment, ground rules, tool versions
docs/observability.md    runtime monitoring pass — errors, DB pressure, hot flows
docs/widget-recovery.md  open work order — restoring the widget packages
scripts/setup-tools.sh   idempotent toolchain build
Ledger/mdlsource/        all MDL source, numbered in dependency order
widgets-src/vegachart/   the project's own pluggable widget (Vega-Lite / Vega)
Ledger/tests/            microflow tests (mxcli test --local)
Ledger/theme/            Atlas token overrides
Ledger/themesource/      component styling
docs/screenshots/        the images above
```
