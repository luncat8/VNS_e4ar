# Findings, pitfalls, skills

Notes for whoever (human or LLM agent) works on this engine next. Not a changelog:
each entry is a rule that cost something to learn, with the failure it prevents.
Code-level "why" comments belong in `vns.js`; this file is for the transferable
lessons.

## Scroll engines

**Three phases, never two: `measure` → `arrange` → `frame`.** The core owns one
read pass per frame and one write pass. A controller's `measure()` collects
elements and creates anchors; `arrange()` reads the Y values the core filled
*between* the two; `frame()` writes. Symptom of skipping `arrange` (reading the
shared anchor table inside `measure`): anchors come back `NaN`, and because
`NaN` comparisons are false everywhere, the engine silently resolves to index 0 —
"the theme never changes" and "the wagon never parks" look like *unrelated* bugs.
Any code that needs another controller's positions also belongs in `arrange`,
which is why registration order is part of the contract.

**Anchor with zero-size absolutely positioned markers, never with `offsetTop`.**
`offsetTop` measures from the offset parent, which changes when a container gains
`position:relative` (harness panels do that constantly). `getBoundingClientRect`
is viewport-relative and therefore scroll-dependent. A `<i class=vns-a>` of
`position:absolute;width:0;height:0` adds nothing to any line box and nothing to
scroll height, so *inserting the instrument does not disturb the measured thing* —
that property is what makes the whole measurement scheme honest.

**Anything hoisted out of the flow needs its marker remembered by parent**, not
by the element (`__vnsHost`, then `m.parentNode === m.__vnsHost && m.__vnsHost.isConnected`
to tell "author moved it" from "content was regenerated"). Hoisting *does* shift
the text after it (the wagon's own space is released), so markers must be created
and measured in the same pass, after hoisting.

**Stamp-collect-prune, and stamp only survivors.** A `data-static` opt-out that
is stamped "seen" before being skipped leaves the element hoisted in the layer
forever: pruned by nobody, driven by nothing. Set the stamp when you push.

**`min(park, push)`, never `max`.** `pos = max(free, min(parkTarget, pushY))`
equals `pushY` for *every* not-yet-parked wagon, so a background that is nowhere
near the top gets dragged off the bottom of the screen. Correct form is
`min(max(free, parkTarget), pushCeiling)`, i.e. park at the edge *unless* the
next wagon has already reached that edge, in which case get pushed. A chain of
"any height" divs with no gap is the same train as one `100vh`-tall stack, so
there is no reason to special-case heights — and a `park`-gated push (`pushY`
only valid once `free<=0`) would leave a `H-G` jump the instant a wagon parks.

**Push starts at contact, not at park.** `pos[i+1] - ext[i]` reaches 0 before
`free[i]` does; that is the intended "train starts moving". Assert the pair as
*touching* (`pos[i]+ext[i] === pos[i+1]`), and never let an assertion read as
"while parked, `pos <= 0`" — a wagon parked while its text is still riding sits
at exactly 0.

**Never compare Y values from different frames.** Using a stale `free[i]` against
a freshly measured `y[i+1]` in the same write loop produces a one-frame jump
precisely when a wagon parks, which is the one moment anyone watches.

**Reversibility is a structural property, so test it as one.** Position is
`f(scrollY, measured constants)`; if it holds, "jumps on fast scroll", "wrong
position after reload" and "desync with text" cannot exist. Walk 10 positions
down and up and compare the written strings byte for byte — that is a much
stronger test than eyeballing a scroll, and it is cheap.

**Write gates beat clever math.** Compare the *numbers* you are about to write
against the last written ones and skip the DOM entirely — a parked wagon costs
zero style work per frame. Track a `writes/frame` counter and show it: a number
that returns to 0 when you stop scrolling is the proof that "no permanent rAF
loop" is real (a permanently spinning `requestAnimationFrame` silently drains
laptops and fakes 60fps in the FPS readout).

**Fixed layers: `width:100%`, never `100vw`.** `100vw` includes the scrollbar, so
a `cover` wagon becomes wider than the page and creates phantom horizontal scroll
(and the story shifts when a scrollbar appears/disappears). One `position:fixed`
layer under `#app` also beats per-wagon `position:fixed`: no ancestor
`transform`/`filter`/`contain` can silently re-parent it, and no ancestor
`overflow:hidden` can clip it.

**`will-change:transform` on ~20 viewport-sized layers is VRAM, not a win.**
Cap `n`; measure.

## Colour and morph

**Lerp channels in linear light.** sRGB values are gamma-encoded; a straight
midpoint between two saturated colours passes through mud. Two 1024-entry LUTs
(`S2L`/`L2S`, exact at both ends) cost one array read per channel per frame and
make the mid-morph the test for it (`mid(sum) > 300`, where sRGB mixing gives
254) — that is how you prove a perceptual claim mechanically.

**Per-anchor, per-channel "declared or hold".** `data-bg` on one chapter and
`data-fg` on another is normal; if the missing side becomes `0`, the page blacks
out. Resolve to "index of the last anchor that declared this channel" once per
refresh (an `Int32Array` of anchors, `-1` = nothing declared yet → skip the write
and let CSS keep its value). Paint an unparseable `data-bg` verbatim at the anchor
(`t===1`) so a gradient or `url()` is legal as a token while colours still lerp.

**Never put `background` or `filter` in a transition list on themed elements, and
never animate `filter` on a container of scrolling text** — per-frame raster of
every layer inside it. The lerp *is* the smoothing; a `transition` on top adds lag
and makes scroll position ambiguous (same Y, two colours depending on where you
came from). Quantise a published progress var (`--vns-t` at 1/64) so it does not
invalidate styles every pixel.

## Events

**Hysteresis belongs on the reset edge only.** `[40px margin][reset][trigger][40px]`:
put it on the set edge and the event arrives 40 px late, which is visible.

**`display:none` elements have no box.** A `<script>` trigger gets `h=0`: `end`
means "the tag itself crossed the top", which is exactly the author-facing knob
(move the tag, move the trigger) and removes every "last child of section"
heuristic. `IntersectionObserver` cannot express `scrollY == Y` at all (it
reports intersections, not positions), batches asynchronously, and gives a
non-reversible state machine.

**Do not fire events for what was already on screen at load.** A restored mid-document
`scrollY` would otherwise re-animate every topic above the current position in one
frame. Pre-fill the latch table before the first `frame()`.

**`skip` must be distinguishable from `end`.** If `view` means "position passed the
top edge", a flick and a slow read produce the same edges; define `view`/`center`
as *viewport overlap* so a jumped topic never latches, and `skip` becomes
`(end fresh && !viewLatched)`.

**Keep the author's nodes.** Replacing `<script type=txt>` with a comment destroys
the document on every regen; keep the node, hide it with CSS, and reuse one frozen
`detail` object (a frozen payload is the cheapest no-garbage argument bundle).

## Numbers and parsing

**Run the spec's snippets.** Two working examples of plausible-but-wrong: the hex
nibble `c > 9 ? c-0x37 : c-0x30` (→43 for 'b', so `#0b1020` parses as 43 — the
classic off-by-`0x30`/`0x37` mistake is invisible in review), and scaling `rgb()`
components by `v > 1 ? v : v*255` (so `rgb(1,2,3)` becomes 255). Alpha is the
only 0-1 channel in CSS colours; components are 0-255 with `%` support.

**`data-size` instead of `new Image()`** to know a background's box: an inline SVG
or data URI decodes synchronously, so the measure pass never waits on the network
and the mode test cannot be polluted by an async callback.

## Generated markup and CSS

**A generated value must not contain the character that closes its own attribute.**
`style="background-image:url("data:image/svg+xml,…")"` ends at the second `"`: the
value becomes `background-image:url(` and the rest of the URI turns into junk
attributes on the element. Percent-encoding is what saves you (nothing in the
payload is a raw quote), so build the *bare* URI in the shared helper and let each
call site write `url('…')` — a builder that returns `url(…)` cannot choose which
quotes are safe. Mechanical guard: assert that every element in the generated
document carries **only** the attributes the contract lists; truncation then fails
loudly (8 stray attributes) instead of "the picture is missing".

**`background-image: <gradient> 50%/72px` is not valid CSS.** Position and size
after an image belong to the `background` shorthand only, so the whole declaration
is dropped and the box is silently transparent. Emit `background-size` as its own
declaration. Same trap family: never put `background` in a `transition` list, and
never write `!important` from script to fix a specificity problem you could fix by
moving a rule.

**Prove every gate fails before trusting it green.** Flip one quote back and re-run
(30 seconds) — a suite whose assertion is vacuous is worse than no suite, because
it argues for the code in review.

## Testing without a browser

Node runs the math (`test/math.js`), jsdom plus a synthetic block layout runs the
DOM mechanics (`test/dom.js`), jsdom loading the real `index.html` runs the wiring
(`test/page.js`). What that found in a fresh implementation: two colour-parse bugs,
the measure/arrange phase bug, the `data-static` stamp bug, and `VNS.refresh()`
being live while the engine was disabled.

- Model layout with `data-lay` heights: an element's height is its declared
  `data-lay`, else the sum of its children; patch `getBoundingClientRect`,
  `offsetHeight`, `scrollY` and `scrollTo`. Zero-height markers then shift
  nothing for free, and `#vns-layer` returning 0 models `position:fixed`.
- jsdom `document.readyState` is `'loading'` when the constructor returns:
  `boot()` runs on `DOMContentLoaded`, so await `'load'` before poking state.
- jsdom implements custom properties and normalizes inline transforms
  differently (`translate3d(-1px,0px,0)`), so QA probes must parse
  transform numbers with a tolerant regex and never compare formatted strings
  across engines. Worse: once anything writes `el.style.x` after `innerHTML`,
  jsdom re-serializes the whole attribute (`url('` becomes `url("`, spaces are
  inserted) — so a test that greps serialized CSS text tests jsdom, not the page.
- jsdom's `DOMParser` is a stub for non-HTML types: it reports `parsererror` for
  perfectly good SVG. Parse generated SVG with `saxes` directly (strict, tiny API:
  `on('opentag')` + `on('error')`), which is also the only way to catch an
  unescaped `&`/`<` in an image the browser would render as a blank box.
- Top-level `let`/`function` in a classic script is reachable from
  `window.eval`, which makes a page script drivable from a test without
  exporting anything; also why every file ends with a
  `if (typeof module !== 'undefined' && module.exports)` tail rather than a
  mid-file `return` guard (meaningless in a script, and the file must stay
  `node --check`-able).
- Drive reversibility/`jump` probes with synchronous `scrollTo` + `VNS.step()`
  loops, not with `autoscroll`: a rAF-driven animation is a human aid, not a
  sampling clock.
- When expectations come from hand-computed arrays they are wrong about half the
  time. Derive them from the invariant instead (contact equality, monotonicity,
  "moved with the text or not at all"), and generate random layouts with a seeded
  PRNG so a failure reproduces from the printed seed.

## Sandbox reality check

There is no browser here and Playwright's CDN is blocked, so **nothing in this repo
proves paint**. Never write "verified in browser" — the honest state is: math green
in Node, DOM mechanics green in jsdom, page wiring green in jsdom, look and feel
pending a human on the served preview.

## Repo conventions

`AGENTS.md` rules that actually bit: single tabs for indentation, LF, early returns
over nesting, no allocations in the frame loop (preallocated typed arrays mutated in
place), and plans are *self-contained artifacts* — a fork must be implementable from
`0.*-plan-*.md` alone, so implementation chatter stays out of them and only the "why"
of a non-obvious line goes into code comments.
