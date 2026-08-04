# Finding 67 — evidence pack

Requested detail on: *an `action`-typed property on a pluggable widget is
accepted by MDL and silently dropped from the model.*

## Short version

Three corrections to the working hypothesis, and a repro that needs no
marketplace module.

1. **CustomChart's schema does have an action slot.** Its `.mpk` declares
   `<property key="onClick" type="action">`, and `mxcli widget describe` prints
   it. The slot is not the problem.
2. **The generated `.def.json` is where it disappears.** `customchart.def.json`
   has **18** `propertyMappings`; `describe` reports **22** properties. The four
   missing ones are the two `system` properties and — the one that matters —
   `onClick`.
3. **This is not CustomChart-specific.** No generated def in this project
   contains a single action mapping. Across 42 defs the only operations emitted
   are `primitive`, `texttemplate`, `attribute`, `datasource` and `selection`.
   There is no `action` operation at all.

**24 of 24** widgets that declare an action property *and* have a generated def
lose it. (8 more declare one but got no def generated.)

## Why MDL-WIDGET01 does not fire

The check *does* work — it is looking at a different list than the writer.

A control, in one page, one widget:

```
pluggablewidget 'com.mendix.widget.web.datagrid.Datagrid' dg67 (
  datasource: database Ledger.Category,
  onClick: microflow Ledger.SYNC_RuleCounts,
  bogusPropertyThatDoesNotExist: 42
) { column c1 (attribute: Name, caption: 'Category') }
```

```
✗ page Ledger.PROBE_67: widget `dg67` (datagrid) has no property
  `bogusPropertyThatDoesNotExist`  [MDL-WIDGET01]
```

The bogus key is rejected; `onClick` is not. So the key validator has a
known-key list that **includes** `onClick` — i.e. it reads the full widget
definition, which knows about actions. The write path reads
`propertyMappings`, which does not. Anything in that gap validates cleanly and
writes nothing.

That makes the diagnosis "validator and writer use different views of the
widget" rather than "`onClick:` bypasses the validator". Either way the fix
belongs in the def generator: it needs an `action` operation, and until it has
one, no widget-level warning can be written that is not itself guessing.

## Reproducing without the Charts module

`Data grid 2` ships with every Mendix project and declares three action
properties:

```
onClick                action (General::Events)
onSelectionChange      action (General::Events)
onConfigurationChange  action (Personalization::Configuration)
```

[`repro-datagrid2.mdl`](./repro-datagrid2.mdl) is the minimal case. Against a
stock project:

```bash
mxcli check  repro-datagrid2.mdl -p App.mpr --references   # Check passed!
mxcli exec   repro-datagrid2.mdl -p App.mpr                # Created page
mxcli -p App.mpr -c "DESCRIBE PAGE MyModule.PROBE_67"      # onClick absent
mx check App.mpr                                           # 0 errors
```

Observed here — the whole widget round-trips minus the action:

```
datagrid dg67 (DataSource: database from Ledger.Category) {
  column Name (Attribute: Name, Caption: 'Category')
}
```

Every stage reports success. The app builds, runs, and the grid is simply not
clickable.

## Files

| File | What it is |
|---|---|
| `customchart.def.json` | The generated def, as produced by `mxcli widget init` in this project. 18 mappings, no `onClick` |
| `CustomChart-events-block.xml` | The `Events` property group from `Charts.mpk`, showing the declared action slot |
| `repro-datagrid2.mdl` | Module-free repro using Data Grid 2 |

## Suggested check, once the generator emits actions

The warning originally proposed — "an action property was supplied but the
widget has no action slot" — would have been wrong here, because CustomChart
*does* have one. A more useful pair:

- **Generator:** emit an `action` operation for `type="action"` properties.
- **Check, meanwhile:** if an MDL property key resolves in the widget's
  definition but has **no mapping in the generated def**, warn that it will be
  dropped. That is computable from the two artifacts mxcli already has, needs no
  per-widget knowledge, and would have caught this the first time.

## A related note

Finding 69 is worth reading alongside this one. Even with `onClick` wired,
CustomChart forwards `JSON.stringify(points[0].bbox)` — the segment's screen
rectangle — to `eventDataAttribute`, not the clicked point. So fixing 67 alone
makes the property settable but still would not have made this particular chart
drillable. That is a widget limitation, not an mxcli one.
