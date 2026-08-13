# Restoring the widget packages

**Status: done (2026-08-13). `mx check` reports 0 errors and `Ledger/widgets/`
is committed.** Kept as the record of what was run and what bit along the way —
findings 81–86 in [`FINDINGS.md`](../FINDINGS.md) carry the diagnosis.

What actually happened, against the plan below:

- The eight pinned widgets went in with `mxcli marketplace install <id>
  --version <v>`, which is type-aware and copies a widget straight into
  `widgets/`. Data Grid 2, Gallery and the grid filters came out of the Data
  Widgets 3.11.3 module package (`unzip -j … 'widgets/*.mpk'`), leaving the
  model alone since `themesource/` was already current. That took 116 errors
  to 2.
- The last two were Atlas_Core native phone layouts on Feedback 3.4.0.
  Extracting *all* of Atlas Core 4.3.8's bundled widgets to fix them went to
  **78 errors**: the module ships Image 1.5.0 and Combo box 2.6.1, older than
  the standalone packages the model wants. Taking only Feedback and re-pinning
  those two settled it at 0. See finding 85.
- `*.mpk` is out of `.gitignore` and `Ledger/widgets/` is committed (12 MB).
  That is the part that actually fixes finding 82 — and it became
  non-negotiable once the project gained a widget of its own, which no one can
  fetch from the Marketplace.
- **The icon trap below is still live.** Nothing here re-applied file 22, and
  the six icons were verified intact afterwards.

---

## What happened

Commit `b1856a7` ("Fixed and menu icons") is the first change to this app made
in Studio Pro rather than through mxcli. It did two things, and both need
attention:

1. **Marketplace widgets were updated.** Studio Pro downloaded new `.mpk`
   packages and rewrote the widget instances inside `Ledger.mpr` to match. The
   instances travelled with the commit; the packages did not, because
   `.gitignore` carries `*.mpk`. Every clone but the authoring machine now has a
   model that describes widgets it does not have.

2. **Icons were added to the six navigation menu items.** MDL can neither read
   nor write them, so they are one full re-apply away from being deleted. See
   [The icon trap](#the-icon-trap) — that part is *not* fixed by this work order.

## Current state

```
$ ~/.mxcli/mxbuild/11.13.0/modeler/mx check Ledger.mpr
The app contains: 116 errors.        # all CE0463, "definition of this widget has changed"

$ ~/.mxcli/mxbuild/11.13.0/modeler/mxbuild … Ledger.mpr
BUILD FAILED
```

Ten of the 116 are in the `Ledger` module: six Data Grid 2s (`dgMatrix`,
`dgBudgets`, `dgTransactions`, `dgNeedsReview`, `dgCategories`, `dgRules`),
three Combo boxes on `CategoryRule_Edit`, and `galAccounts`. The rest are in
Atlas page templates, Administration, MyFirstModule and FeedbackModule. The
Dashboard is clean — CustomChart is unaffected, so the sunburst and sankey are
intact.

## Prerequisite

`MENDIX_PAT` must be present in the environment. It is read directly by mxcli —
no `mxcli auth login`, which is a browser device flow this container cannot
complete.

```bash
env | grep -c '^MENDIX_PAT'          # must print 1, not 0
mxcli marketplace search "Charts"    # must return results, not a 401
```

If the count is 0, the variable was added to the environment configuration
*after* this container was created. Environment variables are injected at
container start, so it needs a fresh session — nothing in the container can be
edited to work around it.

## Target versions

Eight widgets are pinned by version and content GUID in
`Ledger/widgets/widgets-appstore-metadata.json`, which Studio Pro wrote in the
same commit. That file is the source of truth for those eight:

| Package | on disk now | target |
|---|---|---|
| Image | 1.5.0 | **1.6.0** |
| Combo box | 2.5.0 | **2.9.0** |
| Charts | 6.2.1 | **6.3.2** |
| Maps | 4.0.0 | **4.1.0** |
| Timeline | 3.2.2 | **3.2.3** |
| Badge | 3.2.2 | **3.2.3** |
| Progress Bar | 3.2.2 | **3.2.3** |
| Progress Circle | 3.3.2 | **3.3.3** |

**The metadata file does not cover Data Grid 2 or Gallery**, even though six of
Ledger's ten errors are theirs. Those ship inside the **Data Widgets** module,
whose version is in `Ledger/themesource/datawidgets/.version`:

| Module | on disk now | target |
|---|---|---|
| Data Widgets | 3.5.0 | **3.11.3** |
| Atlas Core | 4.1.3 | **4.3.8** |

Both modules' `themesource/` trees were already updated by the commit — it is
only the widget packages inside `Ledger/widgets/` that are missing. Check what a
module install would overwrite before running one, and prefer fetching just the
packages if that is possible.

Read the installed version of any package with:

```bash
unzip -p Ledger/widgets/<file>.mpk package.xml | grep clientModule
```

## Do not use these

Both look like the fix and both make things worse:

- **`mxcli widget sync`** reconciles instances *down* to the installed package.
  With stale packages it runs backwards: `--dry-run` reports **746 property
  changes across 65 instances**, stripping the Data Grid 2 3.11 selection and
  dynamic-pagination properties to match 3.4.0. It is the right tool for
  packages ahead of the model; here the model is ahead of the packages.
- **`mx update-widgets`** clears CE0463 but, per mxcli's own help, "destroys the
  `mprcontents/` folder on MPR v2 projects". This is an MPR v2 project.

## Steps

1. Verify the prerequisite above.
2. Fetch the eight widget packages at the pinned versions into
   `Ledger/widgets/`, and the Data Widgets package(s) supplying Data Grid 2 and
   Gallery. `mxcli marketplace download` takes a numeric content id; use
   `marketplace info` / `versions` to resolve one, or `marketplace install` for a
   module. Confirm each written `.mpk` reports the target version.
3. `mx check Ledger.mpr` → expect **0 errors**. If CE0463 survives, name the
   widget and find its package; do not reach for `widget sync`.
4. Remove `*.mpk` from `.gitignore` (line 14) and `git add Ledger/widgets/`
   (~9.6 MB). Committing the packages is the actual fix — without it the next
   clone breaks the same way.
5. Re-apply all 24 MDL files from scratch and re-check — but read
   [The icon trap](#the-icon-trap) first, because file 22 will delete the
   navigation icons.
6. `mxcli test tests/*.test.mdl -p Ledger.mpr --local` → 8/8.
7. Run the app and confirm the Dashboard still renders both charts. Charts moved
   6.2.1 → 6.3.2 and the sunburst and sankey are hand-built Plotly payloads
   through CustomChart, so the bundled Plotly version is worth confirming.
8. Update `FINDINGS.md` 82 with what worked, and this file's status line.

## The icon trap

**This is not fixed by the work order above, and step 5 will trigger it.**

`mdlsource/22-dashboard-page.mdl` owns the navigation block. `create or replace
navigation` deletes and recreates the menu items rather than updating them —
every item comes back with a new object id — so the icons are not preserved,
they are discarded with the objects that held them. All six read back `(none)`
afterwards, with no warning and no change in the `mx check` count. Both engines
do it; `--engine legacy` is not a way out.

Until MDL can round-trip icons, either:

- skip the `create or replace navigation` block in file 22 when re-applying, or
- accept the loss and have the icons re-added in Studio Pro afterwards.

The icons as committed, should they need restoring by hand:

| Menu item | Kind | Value |
|---|---|---|
| Dashboard | Icon collection | `Atlas_Core.Atlas.align-center` |
| Cashflow | Icon collection | `Atlas_Core.Atlas.align-bottom` |
| Budgets | Icon collection | `Atlas_Core.Atlas_Filled.alert-circle` |
| Transactions | Icon collection | `Atlas_Core.Atlas_Styling.aligncontent-horizontal-space-between` |
| Accounts | Glyph | code `9999` |
| Categories & rules | Image | `System.Images.Close` |

To read the icons back out of the model — there is no mxcli command for it,
because that is the bug — decode the navigation unit's BSON. The unit is the
one file under `Ledger/mprcontents/` containing `NavigationDocument`; each menu
item's `Icon` is a `Forms$IconCollectionIcon`, `Forms$GlyphIcon` or
`Forms$ImageIcon`, or absent.
