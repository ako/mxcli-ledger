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

## The data side

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
