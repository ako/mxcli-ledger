# Getting the widget into a Mendix project

## What you need

- Node 18+ and npm. The build uses `@mendix/pluggable-widgets-tools`.
- A Mendix project whose version matches the tools version. This widget is built with
  `@mendix/pluggable-widgets-tools` 11.12.1 against a Mendix 11.13.0 app. Match the
  major version to your project's.

## 1. Copy the source

Copy the whole widget source directory into the consuming repository — beside the
Mendix project, not inside it. A `widgets-src/vegachart/` next to `MyApp/` keeps the
source out of the `.mpr` and out of Studio Pro's way:

```
myrepo/
  MyApp/                 <- the Mendix project
    widgets/             <- built .mpk goes here
  widgets-src/
    vegachart/           <- this source
```

The source is four files that matter:

| File | Role |
|---|---|
| `src/VegaChart.tsx` | The component. Parses spec and data separately, embeds, cleans the click datum. |
| `src/VegaChart.xml` | The property definitions and the widget id. |
| `src/package.xml` | The client-module manifest. |
| `src/ui/VegaChart.css` | The stylesheet. **Must** be imported by the TSX or it never reaches the bundle. |

## 2. Re-namespace it

The widget id carries whoever built it first. Three edits change it — verified end to
end, the built package carries the new namespace throughout including the id inside
`VegaChart.xml`:

| File | Change |
|---|---|
| `package.json` | `"packagePath": "ledger.widget.web"` → `"acme.widget.web"` |
| `src/package.xml` | `<file path="ledger/widget/web/vegachart" />` → `acme/widget/web/vegachart` |
| `src/VegaChart.xml` | `id="ledger.widget.web.vegachart.VegaChart"` → `id="acme.widget.web.vegachart.VegaChart"` |

After building, the package is `dist/1.0.0/acme.widget.web.VegaChart.mpk` and every path
inside it is under `acme/`.

Do this **before** placing any widget on a page. Renaming afterwards means every page
that carries the widget has to be re-applied.

## 3. Build

```bash
cd widgets-src/vegachart
npm ci
npm run build          # -> dist/1.0.0/<namespace>.VegaChart.mpk
cp dist/1.0.0/*.mpk ../../MyApp/widgets/
```

The bundle carries Vega, Vega-Lite and vega-embed, so it is large (megabytes, not
kilobytes). That is the cost of the whole grammar being available client-side.

## 4. Commit the .mpk

**Commit `MyApp/widgets/*.mpk`.** A `widgets/` folder in `.gitignore` looks tidy and
makes every other clone of the repository unbuildable — the project references a widget
nobody else has, and the error names a missing widget rather than a missing file.

The widget definition cache (`MyApp/.mendix-cache/`, `deployment/`) is a different
matter and should stay ignored.

## 5. After changing the widget's XML

Changing a property definition invalidates every placed instance:

```
[error] [CE0463] "The definition of this widget has changed. Update this widget by
right-clicking it and selecting 'Update widget'..." at Vega Chart 'chartSpark'
```

In Studio Pro that is "Update all widgets". From MDL, re-apply the page files that carry
the widget — recreating the page writes the instance against the new definition. Pages
recreated after the rebuild are already correct; only ones written before it are flagged.

## 6. Check it landed

```bash
mx check MyApp.mpr          # 0 errors
```

A widget that is present but not registered fails at build, not at run. Get the project
to 0 errors before writing any spec — otherwise a spec problem and a packaging problem
look identical from the browser.
