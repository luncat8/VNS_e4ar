## Built

| file | what it is |
|---|---|
| `vns.js` (711 ln) | the engine: hoisted wagon layer, shared anchor table, per-anchor colour morph, `<script type="txt">` events |
| `harness.js` / `harness.css` / `index.html` | seeded content generator, 10 Hz diagnostics, autoscroll, wireframes, QA probes, all inline-SVG art (zero network) |
| `test/` | four gates + `run.js` |
| plans `0.0–0.4` | corrected and kept self-contained; `findings-pitfalls-skills.md` filled with the durable rules |

**Gates:** `math.js` 72 917 checks (pure scroll/colour/event math, no deps — including a 72 k-check sweep over random layouts proving reversibility, monotonicity, contact-equality and anchor alignment) · `dom.js` 124 (engine mechanics over a synthetic block layout: markers, hoisting, refresh/regen, write phase, classes, event order) · `page.js` 27 (loads the real `index.html` in jsdom: every control id, hoisting, QA probes running, `?engine=0`) · `assets.js` 37 (every inline style is legal CSS, every generated SVG data URI is well-formed XML sized like its `data-size`, engine CSS has a rule per mode, harness CSS keeps the DOM contract).

## Bugs the implementation found in the plans' own design

- **Missing third phase.** Controllers read anchor Y inside `measure()` — before core's single rect pass — so anchors were `NaN`, and because `NaN` comparisons are false everywhere the engine silently resolved to index 0: "theme never changes" *and* "wagon never parks" from one cause. Now `measure → arrange → frame`.
- **`parked` re-fired on reverse scroll** (I had it clear on `pos != 0`). Now one-shot per pass like every other edge; 0.4's criteria rewritten to say so.
- **`data-static` left orphaned wagons in the layer**: the element was stamped "seen" before being skipped, so the prune loop ignored it.
- **`VNS.refresh()` was live with `?engine=0`** and threw on a null root — a disabled engine is now inert on every entry point (and still publishes an empty `VNS.wagons`).
- **Two colour-parse bugs from the plan snippets**: hex nibble `c-0x37` (`#0b1020` → 43) and `rgb(1,2,3)` scaling.
- **Two paint-killers in my own harness**: `style="…url("data:…")"` truncated the attribute at the nested quote (every `fixed`/`auto` wagon would have painted nothing), and `background-image: <gradient> 50%/72px` is invalid outside the `background` shorthand. I re-introduced the quote bug afterwards to confirm `assets.js` fails on it — a green gate has to be proven capable of red.

## Preview (live on port 8000)

`space` autoscroll · `q` QA all (expect ~10 green rows) · `w` wireframes · `r` regen · `t`/`b` top/bottom · `↑↓` chapter jump. Engine switches are URL flags: `?engine=0 ?wagons=0 ?morph=0 ?events=0 ?hysteresis=N ?parkedAsView=1 ?replay=1`, and the `#…` hash *is* the whole story config — so the URL is the bug report.

Things only you can judge, since there's no browser here (Playwright's CDN is blocked): wagon top sitting on its text line; park → hold → push having no visible jolt and retracting identically; the morph not snapping at boundaries; `data-dir` exits (chapter 4); and `?engine=0` reading like a normal article. In the panel, `writes/frame` and `frames/s` should both fall to 0 the moment you stop scrolling.
