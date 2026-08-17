---
name: mendix-vega-charts
description: Chart a Mendix app with Vega-Lite through a pluggable widget that takes the specification and the data as separate properties, so the model emits rows and never assembles a chart payload. Use when a Mendix project needs charts Studio Pro's own widgets do not cover — small multiples, faceted tables, sparklines inside a data grid, calendar heatmaps, brushed scatter plots, stream graphs — or when an agent is authoring charts from MDL rather than by hand.
---

# Vega-Lite charts in Mendix

## What this is

A pluggable widget, roughly 150 lines of TSX, with two properties that matter:

| Property | What it carries |
|---|---|
| `spec` | A Vega-Lite or Vega specification, as JSON text. Static, authored once, committed. |
| `chartData` | A string attribute holding a JSON array of row objects. Built by a microflow. |

The widget folds the data into the spec under the name given by `datasetName` and hands the result to `vega-embed`, which picks Vega or Vega-Lite from the spec's own `$schema`. Nothing else happens at runtime.

**The split is the whole point.** The model emits a table of facts; the specification decides what that table looks like. A microflow that concatenates a chart payload — series, axes, colours — is a microflow that has to be edited every time the chart changes, and it cannot be checked without running the app. A microflow that emits `[{"cat":"Groceries","m":"2026-06-01","v":697.70}, ...]` can be checked against the database with a SQL query, and the spec beside it can be compiled and measured without a browser at all (see [Verifying](#verifying-without-running-the-app)).

## Who this is for

An agent. The tradeoff is deliberate: a hand-authored Vega-Lite spec is a large piece of JSON, which is uncomfortable to maintain in Studio Pro's property editor and comfortable for a coding agent that can compile it, render it headless, and measure the result. If a human will maintain the chart by hand in Studio Pro, use Studio Pro's chart widgets instead.

What makes this usable without deep Vega-Lite knowledge is [`specs/`](specs/) — working specifications for the common shapes, each with a sample data file, each of which compiles and renders. Start from the closest one and change fields, not structure.

## Getting the widget into a project

See [`references/install.md`](references/install.md). Summary: copy the widget source, `npm ci`, `npm run build`, put the built `.mpk` in the project's `widgets/` folder, and **commit it** — a gitignored `widgets/` makes every other clone unbuildable.

Re-namespace it away from whoever built it first (`ledger.widget.web.…` here) with three edits, listed in that file. Verified: after the three edits the built package carries the new namespace throughout, including the widget id inside `VegaChart.xml`.

## Using it from MDL

```
pluggablewidget 'acme.widget.web.vegachart.VegaChart' chartSpend (
  chartData: ChartData,
  datasetName: 'table',
  chartHeight: 0,
  renderer: 'svg',
  showActions: false,
  spec: '{ ... }')
```

It needs an entity context — put it in a `dataview` over the object whose attribute holds the data. The full property table, the escaping rules for putting JSON inside an MDL string, and the click-back path are in [`references/properties.md`](references/properties.md).

Two rules worth carrying in your head:

- **`chartHeight: 0` means "as tall as it renders".** A chart whose height is decided by its data — a facet row per category, a legend entry per series — has no height the page can be told in advance, and a fixed container silently stops matching the moment the data grows.
- **Single quotes inside the spec must be doubled.** MDL strings are single-quoted, so a Vega expression like `['Jan','Feb'][datum.m-1]` is written `[''Jan'',''Feb''][datum.m-1]`. It is stored unescaped.

## Two ways to get data in

**As an attribute (the default).** A microflow builds a JSON array into a string
attribute, `chartData` binds to it, and the widget folds it into the spec. Nothing
is fetched; the payload arrives with the page.

**As a URL.** Bind `dataUrl` to a string attribute the model computes. It
replaces the spec's top-level data, and anything already on that data — notably
`format` — survives, which is where an OData envelope is unwrapped:

```
pluggablewidget 'acme.widget.web.vegachart.VegaChart' chartScatter (
  dataUrl: ScatterUrl,          -- computed by a microflow, filter and all
  chartHeight: 0, renderer: 'svg', showActions: false,
  spec: '{ … "data": {"name": "table", "format": {"type": "json", "property": "value"}} … }')
```

**Bind it; do not write the URL into the spec.** The spec is a static string, so
a URL inside it is a constant — a period, a category or an account the reader
chose can never reach it. Computing the address in the model also puts the
escaping somewhere it can be done: a value containing an apostrophe closes an
OData string literal and takes the whole request down with a 400, and the chart
just goes blank.

The older form still works — leave both `chartData` and `dataUrl` unbound and
put the address in the spec — for a feed that never varies:

```json
"data": {
  "url": "/odata/chartapi/v1/MonthCategory?$filter=Yr eq 2026",
  "format": {"type": "json", "property": "value"}
}
```

The widget needs no change for this — with no data bound it passes the spec
through untouched and Vega's own loader does the fetch. Verified end to end
against an endpoint served by the app itself: one `200`, six marks, no error, and
`format.property` unwrapping the `{"value": […]}` envelope OData returns.

Same-origin requests carry the session cookie, so an endpoint authenticated by
session is reachable from a chart on a page of the same app without any token
handling.

### Which to use

The URL form buys: browser caching, a payload that is not part of the page state,
query parameters (`$filter`, `$top`) as the chart's own controls, and one endpoint
serving several charts.

It costs:

- **A second round trip**, after the page has already rendered.
- **The endpoint is API surface.** It is reachable by anything holding a session,
  not just by the chart, so its own security rules have to be right — a chart
  cannot restrict what a URL returns.
- **Rows, not aggregates,** unless the endpoint aggregates. A feed over a
  transaction table sends every row and lets Vega sum them client-side, which is
  fine at hundreds and not at hundreds of thousands. Publishing an OQL **view
  entity** is what keeps the aggregation in the database.
- **Paging is silent.** An OData feed returns its page size and a `nextLink`;
  Vega fetches once. A chart over a paged endpoint quietly plots the first page,
  so cap the result deliberately (`$top`) rather than discovering the cap.
- **`check-spec.mjs` cannot fetch it.** Keep a sample `.data.json` beside the spec
  so it stays checkable offline.
- **`$apply` is not supported** — server-side aggregation through the OData
  aggregation extension returns 400. The *view* has to do the grouping, so an
  endpoint is one grain and a caller cannot re-group it.
- **Two charts on one URL fetch it twice.** Mendix sends no `Cache-Control` and
  no `ETag`, so the browser cannot revalidate and Vega does not deduplicate
  loads across views. Measured: two identical 237 KB responses on one page load.
- **Name your fields with `$select`.** Without it the feed also sends the key
  OData requires and any column that exists only for the filter — 41% of the
  payload here, 416 KB against 244 KB, for data nothing draws.

Default to the attribute for anything a microflow already computes — it keeps the
figures checkable against SQL and the chart working with no endpoint to secure.
Reach for the URL when the data is genuinely shared, already published, or large
enough that caching matters.

### Publishing the endpoint from MDL

This works, and there is exactly one trap. Aggregate in an OQL view, build the
key as a **column of that view**, publish it, and do not mention
`PublishAssociations`:

```
create or modify view entity Acme.VMonthCategory (
  RowKey: string(200),      -- the public key, built in the view
  Yr: integer, CategoryName: string(200), Total: decimal
) as ( select (cast(datepart(YEAR, t.TxDate) as string) + '-' + cast(c.Name as string)) as RowKey,
       … group by … );

create or modify odata service Acme.ChartApi (
  path: 'odata/chartapi/v1/', ODataVersion: OData4, ServiceName: 'ChartApi'
  -- PublishAssociations deliberately omitted; see below
)
authentication session
{
  publish entity Acme.VMonthCategory as 'MonthCategory' (ReadMode: ReadFromDatabase, …)
  expose ( RowKey as 'RowKey' (Filterable, Sortable, key), … );
};
```

**`PublishAssociations: No` does not mean "publish no associations".** It selects
the *associated-object-id* representation, which requires the system `ID`
published as the key — so the build fails with CE7375 even on a flat view that
has no associations at all. Omitting the property takes the default, "as a
link", and it builds. mxcli warns about this (MDL-ODATA06).

Do not follow CE7375's advice and publish the `ID` instead. Object ids are
autogenerated and differ between environments, so an id in an external contract
breaks the moment a consumer moves from test to production. Key on a business
value, which is why the key above is a column the view computes.

Verified end to end: `mx check` clean, `$metadata` showing the business column as
`<Key>`, figures matching OQL to the cent, `$filter`/`$orderby`/`$top` applied
server-side, and a chart drawing from it in one request.

## The data side (attribute form)

The microflow emits JSON and nothing else. Build it as a string concatenation over a retrieve, ideally over an **OQL view entity** so the aggregation happens in the database:

```
loop $R in $Rows
begin
  set $Json = $Json + $Sep
    + '{"cat":"' + $R/CategoryName + '"'
    + ',"m":"' + $Month + '"'
    + ',"v":' + formatDecimal($R/Total, '0.00') + '}';
  set $Sep = ',';
end loop;
```

`formatDecimal(x, '0.00')` is the right way to write a number into JSON — it emits a plain decimal with no grouping separators. Never write a value that could be empty into an unquoted position; emit `null` instead, and never emit `0` for "no data" (a zero against a full budget reads as maximally under budget, which is a lie the chart tells convincingly).

## Verifying without running the app

`scripts/check-spec.mjs` compiles a spec with sample rows, renders it headless, and reports size, mark counts and any Vega-Lite warnings. It catches most authoring errors in about a second, without a build or a browser:

```bash
cd .claude/skills/mendix-vega-charts/scripts
npm install          # vega + vega-lite, once
node check-spec.mjs ../specs/line-timeseries.json
node check-spec.mjs ../specs/*.json            # all of them
```

Use it for more than pass/fail. Because it exposes the scenegraph, it answers questions a screenshot cannot: how tall does this get with 15 categories rather than 13, do these facet rows share a pitch, where did that band edge actually land. Several of the failure modes below were only ever settled by measuring the scenegraph.

## When a chart looks wrong

Read [`references/failure-modes.md`](references/failure-modes.md) **before** guessing. It catalogues the ones that cost real time on this project, each with the symptom, the cause and the fix — a tooltip that silently un-aggregates the chart it is attached to, facet rows that drift out of alignment, a fixed container that stops matching its chart, `DESCRIBE PAGE` output that will not round-trip, and a stylesheet that never reaches the bundle.

The general rule from all of them: **measure the rendered output, do not reason about the spec.** More than once here the first hypothesis was wrong and the measurement was decisive in one command.
