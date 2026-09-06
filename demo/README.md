# Ledger — demo films

Produced with mxcli's `record-narrated-demo` skill. The machinery
(`narrate.js`, `take.js`, `cut-clips.js`) is copied from the skill unchanged;
only `narrated-walkthrough.js` and `capture/clips.json` are this project's.

| file | what it is |
|---|---|
| `assets/ledger-demo-desktop.mp4` | **the product film** — 66.6s, 1920×1080 |
| `assets/ledger-demo-mobile.mp4` | the same walk at 414×896 — **evidence, not marketing** (see below) |
| `assets/clips/`, `assets/clips-mobile/` | the eight per-beat clips each film is cut from |
| `capture/beats.json`, `capture/mobile/` | marks, clock anchors and the beat assertions |
| `capture/contact-sheet.jpg` | one frame from the middle of every clip |

Both takes: **8 of 8 beats asserted and held, 0 runtime dialogs.**

## The walk

Sam keeps the household books. Open on two years already sorted → the year in
two numbers → twelve months per category → switch to variance to find the misses
→ click a month to see the payments behind it → next year's plan → the pile that
still needs a decision → and it can look like whichever bank Sam banks with.

No Mendix vocabulary anywhere: no entity, microflow, page or association. If the
visual needs those words, the visual is wrong.

## Two things the process caught that a screenshot would not

**The contact sheet paid for itself on the first take.** Beat 05 claimed
"clicking a month opens the actual payments behind it" while the picture showed
the same grid as the beat before — the drill panel renders below the fold and the
camera never scrolled to it. It was also the one beat with no `assertBeat`, which
is why it got as far as a cut film. Both fixed: `bringIntoView` plus an assertion
that the panel names the cell it opened.

**The mobile take found a real defect, which is what it is for.** At 414×896 the
sidebar renders 232px wide and never collapses, leaving 182px for the whole app;
the review grid's six columns come out 32–56px, so merchant names read as `T.`
and `B`. The manual toggle recovers most of it (232 → 52px, columns → 42/64/85),
so the mechanism works — it just does not happen automatically.

The control is what makes it a finding rather than an impression. Same app, same
viewport, same moment:

| layout | sidebar rendered |
|---|---|
| `Ledger.App_Default` (mxcli's copy of Atlas) | **232px** |
| `Atlas_Core.Atlas_Default` (untouched) | **52px** |

The inline `--sidebar-size` is `232px` in both, so this is not the width property
— it is the scroll-container shrink behaviour the layout copy dropped. That is
FINDINGS §142's third loss, the silent one, and this is the first measurement of
what it costs.

**So the desktop film ships and the mobile film does not.** The app functions on
a phone and is not usable on one; a demo that showed it would be selling
something untrue.

## Re-recording

```sh
mxcli run --local -p Ledger/Ledger.mpr --ensure-db     # app must be up
node demo/narrated-walkthrough.js                       # desktop
PROFILE=mobile node demo/narrated-walkthrough.js        # phone
CLIPS_OUT=demo/assets/clips node demo/cut-clips.js \
    demo/capture/beats.json demo/capture/clips.json
# then LOOK AT demo/capture/contact-sheet.jpg before assembling
```

`cut-clips.js` resolves the raw take as `<dirname of beats.json>/raw/<video>`, so
a second profile needs its own directory rather than its own filename — hence
`capture/mobile/`. Audio is not wired: `ffmpeg` had to be installed here
(`apt-get update` first, as the skill warns) and `piper` is absent, so both films
are silent with on-screen narration.
