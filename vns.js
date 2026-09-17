// vns.js — VNS, a visual novella scroll engine: shared core, background wagons,
// style morph, scroll script events. Classic <script>, no build, file:// safe.
// All math is pure and exported, so `node test/math.js` gates it without a DOM.

const VNS = typeof window === 'undefined' ? {} : (window.VNS = window.VNS || {});

const E_VIEW = 1, E_CENTER = 2, E_PARKED = 4, E_END = 8, E_SKIP = 16;
const EVK = 5;
const EV_NAME = ['view', 'center', 'parked', 'end', 'skip'];
const DIR_TOP = 0, DIR_LEFT = 1, DIR_RIGHT = 2, DIR_BOTTOM = 3;
const DIR_ID = { top: DIR_TOP, left: DIR_LEFT, right: DIR_RIGHT, bottom: DIR_BOTTOM };
let scratch4 = new Uint8Array(4);

// --------------------------------------------------------------- pure math

function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

// easeInOutQuad. Its flat ends are what keep a chapter boundary from reading as
// a blink when the user scrolls fast through it.
function ease(t) {
	t = clamp01(t);
	if (t < 0.5) return 2 * t * t;
	const u = 2 - 2 * t;
	return 1 - u * u / 2;
}

// Highest index with ys[i] <= v, else -1. ys is ascending by construction: for
// this engine document order is Y order.
function lastIndexLE(ys, n, v) {
	let lo = 0, hi = n - 1, r = -1;
	while (lo <= hi) {
		const m = (lo + hi) >> 1;
		if (ys[m] <= v) { r = m; lo = m + 1; } else hi = m - 1;
	}
	return r;
}

// The wagon chain: pos[i] = min(max(free[i],0), pos[i+1] - ext[i]), swept bottom
// up. A wagon rides its text, parks at the edge, and is only ever pushed up by
// the wagon below it. A min of continuous functions => no jump, and monotone in
// scrollY => reverse scroll retraces exactly. The second term is a ceiling, so
// a wagon is never placed below its own anchor. A gap shorter than a wagon's
// height couples the pair into a filmstrip: that is the wagon metaphor, not an
// overlap bug — the upper picture leaves as the lower one arrives.
function wagonChain(free, ext, pos, n) {
	let prev = Infinity;
	for (let i = n - 1; i >= 0; i--) {
		const park = free[i] > 0 ? free[i] : 0;
		const ceil = prev - ext[i];
		pos[i] = ceil < park ? ceil : park;
		prev = pos[i];
	}
	return pos;
}

// Parked means pinned at the edge, not merely y==0 because the next wagon
// happens to be touching it while it is still riding.
function wagonParked(free, pos, i) {
	return pos[i] === 0 && free[i] <= 0 ? 1 : 0;
}

// data-dir names the exit direction; timing always comes from the scroll-axis
// chain, so every wagon stays 1:1 with its text. out is [x,y].
// left/right keep y=max(t,0): they park and stay put vertically, so a lateral
// exit never overlaps the wagon below it on the scroll axis.
function wagonExit(t, dir, out) {
	out[0] = 0;
	if (dir === DIR_LEFT) { out[0] = t < 0 ? t : 0; out[1] = t > 0 ? t : 0; return out; }
	if (dir === DIR_RIGHT) { out[0] = t < 0 ? -t : 0; out[1] = t > 0 ? t : 0; return out; }
	if (dir === DIR_BOTTOM) { out[1] = t < 0 ? -t : t; return out; }
	out[1] = t;
	return out;
}

// Chain pos is in wagon-heights. A 256px box sliding 256px right sits in the
// middle of the page and every later wagon nudges it — that is not an exit.
// Scale so t = -ext (next wagon has fully replaced this one) lands x = ±span,
// i.e. just past the viewport edge. span is innerWidth, cached, not read here.
function wagonLateral(x, ext, span) {
	if (x === 0 || !(ext > 0) || !(span > 0)) return x;
	return x * span / ext;
}

// sRGB <-> linear. Lerping channels in sRGB space darkens the middle of a
// blue->red glide; LUTs keep pow() out of the frame loop.
const S2L = new Float32Array(256);
const L2S = new Uint8Array(1024);
for (let i = 0; i < 256; i++) {
	const v = i / 255;
	S2L[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
for (let i = 0; i < 1024; i++) {
	const l = i / 1023;
	const v = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
	L2S[i] = Math.round(clamp01(v) * 255);
}

function nibble(c) { return c <= 0x39 ? c - 0x30 : (c | 32) - 87; }
function isHex(c) { return c >= 0x30 && c <= 0x39 || c >= 0x61 && c <= 0x66 || c >= 0x41 && c <= 0x46; }

// '#rgb' | '#rrggbb' | '#rrggbbaa' | 'rgb(r,g,b)' | 'rgba(r,g,b,a)'.
// out = [r,g,b,a] with a in 0..255. Returns 0 for anything else, so the caller
// can treat an unparseable value as a paint token instead of guessing.
function parseColor(s, out) {
	if (!s) return 0;
	s = s.trim();
	if (s[0] === '#') return parseHex(s, out);
	if (s[0] === 'r') return parseRGB(s, out);
	return 0;
}

function parseHex(s, out) {
	const n = s.length;
	if (n !== 4 && n !== 7 && n !== 9) return 0;
	for (let i = 1; i < n; i++) if (!isHex(s.charCodeAt(i))) return 0;
	if (n === 4) {
		out[0] = nibble(s.charCodeAt(1)) * 17;
		out[1] = nibble(s.charCodeAt(2)) * 17;
		out[2] = nibble(s.charCodeAt(3)) * 17;
		out[3] = 255;
		return 1;
	}
	for (let k = 0; k < 3; k++) out[k] = nibble(s.charCodeAt(1 + k * 2)) << 4 | nibble(s.charCodeAt(2 + k * 2));
	out[3] = n === 9 ? nibble(s.charCodeAt(7)) << 4 | nibble(s.charCodeAt(8)) : 255;
	return 1;
}

function parseRGB(s, out) {
	const a = s.indexOf('('), b = s.lastIndexOf(')');
	if (a < 0 || b <= a) return 0;
	const parts = s.slice(a + 1, b).split(/[,\/\s]+/);
	if (parts.length < 3) return 0;
	for (let k = 0; k < 3; k++) {
		const t = parts[k];
		// Components are 0..255 (or %); only alpha is 0..1. Scaling both by
		// "value > 1" would turn rgb(1,0,0) into 255 — a classic bug.
		const v = t.charCodeAt(t.length - 1) === 37 ? parseFloat(t) * 2.55 : parseFloat(t);
		if (!(v >= 0)) return 0;
		out[k] = Math.round(v);
	}
	let al = parts.length > 3 ? parseFloat(parts[3]) : 1;
	if (parts.length > 3 && parts[3].indexOf('%') > 0) al /= 100;
	if (!(al >= 0)) al = 1;
	out[3] = al <= 1 ? Math.round(al * 255) : Math.round(al);
	return 1;
}

// Mix two 4-byte-per-anchor colour records in linear light into out[0..3].
// Same index on both sides is a copy. Allocation free: called from frame().
function mixColor4(out, src, ia, ib, t) {
	ia <<= 2; ib <<= 2;
	for (let k = 0; k < 3; k++) {
		const a = S2L[src[ia + k]], b = S2L[src[ib + k]];
		out[k] = L2S[((a + (b - a) * t) * 1023) | 0];
	}
	const a3 = src[ia + 3], b3 = src[ib + 3];
	out[3] = (a3 + (b3 - a3) * t) | 0;
	return out;
}

// Which thresholds an anchor sitting `d` px below the viewport top satisfies.
// `view` and `center` require the anchor to still overlap the viewport, so a
// flick past a topic never reports it as seen — that is what leaves `skip` a
// meaningful signal instead of a duplicate of `end`. Pure function of scrollY.
function eventEdges(d, h, vh, parked) {
	const inView = d < vh && d + h >= 0;
	let m = inView ? E_VIEW : 0;
	if (inView && d < vh * 0.5) m |= E_CENTER;
	if (parked) m |= E_PARKED;
	if (d + h < 0) m |= E_END;
	return m;
}

// Edge-triggered step; out = [state, fireMask]. Latch on the forward edge,
// re-arm only after `hs` px of clear space beyond the entry edge, so bouncing on
// a boundary does not spam. Hysteresis goes on the reset side only: on the set
// side it would delay the event itself. skip re-arms whenever view fires.
// `parked` latches like the rest: a wagon that parks again on the way back up is
// not a new event, and reverse scroll must stay silent.
function eventStep(state, edges, d, vh, hs, out) {
	let next = state;
	if (!(edges & E_END)) next &= ~E_END;       // back on screen: re-arm end only
	// Left through the bottom: a new forward pass starts from scratch.
	// PARKED is in this mask (and not cleared on unpark) so reverse scroll
	// stays silent, but a second read after leaving the topic can fire again.
	if (d > vh + hs) next &= ~(E_VIEW | E_CENTER | E_PARKED | E_END | E_SKIP);
	const fresh = edges & ~next;
	next |= edges;
	let fire = fresh;
	if ((fresh & E_END) && !(next & E_VIEW) && !(next & E_SKIP)) { next |= E_SKIP; fire |= E_SKIP; }
	if (fresh & E_VIEW) next &= ~E_SKIP;
	out[0] = next;
	out[1] = fire;
	return out;
}

// ------------------------------------------------------------- engine css
// scrollY is the engine's only input, so the page opts out of scroll
// anchoring: when CSS keyed on a morph class (or anything else) shifts layout
// while scrolled, the browser silently rewrites scrollY to keep the old
// content in place. The chain would then retrace differently for the same
// requested position — reversibility fails by exactly the layout shift, and a
// class boundary can even oscillate with the frame loop's keep-going poke.
// Wagons live in one hoisted layer and are position:absolute inside a fixed
// full-viewport box. That is immune to ancestor transform/filter/contain (which
// silently re-parents position:fixed) and to ancestor overflow clipping. Layer
// width is 100%, not 100vw, so a vertical scrollbar cannot make cover wagons
// wider than the page and cause phantom horizontal overflow.
const CSS = ''
	+ 'html{overflow-anchor:none}'
	+ '#vns-layer{position:fixed;left:0;top:0;width:100%;height:100%;z-index:0;pointer-events:none;overflow:hidden;contain:layout paint}'
	+ '#vns-layer>.vns-bg{position:absolute;left:0;top:0;margin:0;padding:0;border:0;overflow:hidden;'
	+ 'background-repeat:no-repeat;will-change:transform;transform:translate3d(0,0,0)}'
	+ '#vns-layer>.vns-bg[data-mode="cover"]{width:100%;height:var(--vns-vh,100vh);background-size:cover;background-position:50% 50%}'
	+ '#vns-layer>.vns-bg[data-mode="tiled"]{width:100%;height:var(--vns-vh,100vh);background-size:auto;background-repeat:repeat}'
	+ '#vns-layer>.vns-bg[data-mode="contain"]{width:100%;height:var(--vns-vh,100vh);background-size:contain;background-position:50% 50%}'
	+ '#vns-layer>.vns-bg[data-mode="fixed"]{width:512px;height:512px;background-size:100% 100%}'
	+ '#vns-layer>.vns-bg[data-mode="auto"]{width:512px;height:512px;background-size:auto;background-position:0 0}'
	+ '.vns-a{position:absolute;width:0;height:0;margin:0;padding:0;border:0;overflow:hidden;visibility:hidden;pointer-events:none}'
	+ 'script[type="txt"]{display:none}';

// ------------------------------------------------------------------- core

VNS.options = { scope: '#app', engine: 1, wagons: 1, morph: 1, events: 1, hysteresis: 40, parkedAsView: 0, replay: 0 };
VNS.stats = { frames: 0, fires: [0, 0, 0, 0, 0] };
VNS.debug = { n: 0, wet: 0 };

let root = null, layer = null;
let subs = [], subn = 0;
let scrollY = 0, vh = 0, vw = 0, raf = 0, measuring = 1, busy = 0;
let anchorEls = [], anchorYs = [], anchorn = 0;

function flagOf(q, k) {
	const on = q.indexOf(k + '=1'), off = q.indexOf(k + '=0');
	if (off >= 0 && (on < 0 || off < on)) return 0;
	return on >= 0 ? 1 : -1;
}

// URL flags are the whole config channel — ?engine=0 ?wagons=0 ?events=1
// ?replay=1 — so a bug report is a URL and the engine needs no settings UI.
function applyFlags() {
	const q = location.search + '&' + location.hash.replace(/^#/, '') + '&';
	for (const k in VNS.options) {
		if (typeof VNS.options[k] !== 'number') continue;
		const v = flagOf(q, k);
		if (v >= 0) VNS.options[k] = v;
	}
}

function injectCSS() {
	if (document.getElementById('vns-css')) return;
	const s = document.createElement('style');
	s.id = 'vns-css';
	s.textContent = CSS;
	document.head.appendChild(s);
}

// Zero-size absolutely positioned marker. Unlike display:block or an inline
// placeholder it adds nothing to any line box or to scroll height, so inserting
// it can never shift the text whose position it exists to measure. The host is
// remembered because the wagon itself gets hoisted out of that parent.
function ensureAnchor(el, kind) {
	let m = el.__vnsA;
	if (m && m.parentNode === m.__vnsHost) return m;
	if (!m) {
		m = document.createElement('i');
		m.__vnsEl = el;
		el.__vnsA = m;
	}
	const host = el.parentNode;
	if (!host || host === layer) return null;
	m.className = 'vns-a ' + kind;
	host.insertBefore(m, el);
	m.__vnsHost = host;
	return m;
}

function anchorIndexOf(el) {
	if (el.__vnsAi >= 0) return el.__vnsAi;
	el.__vnsAi = anchorn;
	anchorEls[anchorn] = el;
	return anchorn++;
}

// One read pass for all controllers: markers are placed during measure(), rects
// are read once afterwards, so a refresh costs at most one forced layout.
function measureAll() {
	busy = 1;
	scrollY = window.scrollY;
	vh = window.innerHeight;
	vw = window.innerWidth;
	root.style.setProperty('--vns-vh', vh + 'px');
	root.style.setProperty('--vns-vw', vw + 'px');
	for (let i = 0; i < anchorn; i++) anchorEls[i].__vnsAi = -1;
	anchorn = 0;
	for (let i = 0; i < subn; i++) if (subs[i].measure) subs[i].measure();
	for (let i = 0; i < anchorn; i++) {
		const m = anchorEls[i].__vnsA;
		anchorYs[i] = m ? m.getBoundingClientRect().top + scrollY : 0;
	}
	for (let i = 0; i < subn; i++) if (subs[i].arrange) subs[i].arrange();
	busy = 0;
}

function frameAll() {
	scrollY = window.scrollY;
	VNS.stats.frames++;
	for (let i = 0; i < subn; i++) if (subs[i].frame) subs[i].frame();
}

function tick() {
	raf = 0;
	if (measuring) { measuring = 0; measureAll(); }
	frameAll();
	if (window.scrollY !== scrollY) poke();      // keep going while it still moves
}

function poke() {
	if (!raf) raf = requestAnimationFrame(tick);
}

function scopeOf() {
	return document.querySelector(VNS.options.scope) || document.body;
}

// Document order is not Y order for hoisted wagons (they sit at the end of
// body), so every controller sorts by its markers. Stable sort: ties keep
// source order, the only sane answer for two wagons sharing a position.
function sortByAnchorY(list) {
	const n = list.length, tops = [], idx = [], out = [];
	for (let i = 0; i < n; i++) {
		const el = list[i];
		tops[i] = el.__vnsA ? el.__vnsA.getBoundingClientRect().top : 0;   // one read each
		idx[i] = i;
	}
	idx.sort(function (a, b) { return tops[a] - tops[b]; });
	for (let i = 0; i < n; i++) out[i] = list[idx[i]];
	return out;
}

function num(v, min) { return v > min ? v : min; }

// ------------------------------------------------------------------ wagons

let wels = [], wn = 0, wstamp = 0;
let wy = null, wfree = null, wext = null, wpos = null, wdir = null, wparked = null;
let wlastX = null, wlastY = null, wscratch = [0, 0];

// Adopt = give it an anchor, the wagon class, a mode, and an explicit box when
// the author asked for one. Everything else about size stays CSS.
function wagonAdopt(el) {
	if (!ensureAnchor(el, 'vns-w')) return 0;
	el.classList.add('vns-bg');
	if (!el.dataset.mode) el.dataset.mode = 'cover';
	const s = el.dataset.size;
	if (s) {
		const a = s.split(/[x,\s]+/);
		const w = parseFloat(a[0]), h = a[1] ? parseFloat(a[1]) : w;
		if (w > 0) el.style.width = w + 'px';
		if (h > 0) el.style.height = h + 'px';
	}
	return 1;
}

function measureWagons() {
	const scope = scopeOf();
	wstamp++;
	const list = [];
	const marks = scope.querySelectorAll('.vns-a.vns-w');
	for (let i = 0; i < marks.length; i++) {
		const el = marks[i].__vnsEl;
		if (!el || el.__vnsStamp === wstamp) continue;
		if (el.hasAttribute('data-static')) continue;   // un-stamped => pruned back to the author DOM
		el.__vnsStamp = wstamp;
		list.push(el);
	}
	const fresh = scope.querySelectorAll('.bg');
	for (let i = 0; i < fresh.length; i++) {
		const el = fresh[i];
		if (el.__vnsStamp === wstamp || el.hasAttribute('data-static')) continue;
		el.__vnsStamp = wstamp;
		if (wagonAdopt(el)) list.push(el);
	}
	for (let i = layer.children.length - 1; i >= 0; i--) {
		const el = layer.children[i];
		if (el.__vnsStamp === wstamp) continue;
		const m = el.__vnsA;
		el.style.transform = '';
		// Still anchored? hand it back to the author's DOM. Otherwise the content
		// was replaced and the wagon is garbage.
		if (m && m.parentNode === m.__vnsHost && m.__vnsHost.isConnected) m.parentNode.insertBefore(el, m.nextSibling);
		else layer.removeChild(el);
	}

	wels = sortByAnchorY(list);
	wn = wels.length;
	wy = new Float64Array(wn);
	wfree = new Float64Array(wn);
	wext = new Float64Array(wn);
	wpos = new Float64Array(wn);
	wdir = new Uint8Array(wn);
	wparked = new Uint8Array(wn);
	wlastX = new Float64Array(wn);
	wlastY = new Float64Array(wn);
	for (let i = 0; i < wn; i++) {
		const el = wels[i];
		anchorIndexOf(el);
		el.__vnsWi = i;
		wdir[i] = DIR_ID[el.dataset.dir] || DIR_TOP;
		wlastX[i] = NaN;                        // NaN matches nothing: forces first write
		wlastY[i] = NaN;
		layer.appendChild(el);
	}
	for (let i = 0; i < wn; i++) wext[i] = wels[i].offsetHeight;   // box is settled now

	VNS.wagons = { n: wn, els: wels, y: wy, free: wfree, pos: wpos, ext: wext, parked: wparked, dir: wdir };
	VNS.debug.n = wn;
	VNS.debug.els = wels;
	VNS.debug.y = wy;
	VNS.debug.free = wfree;
	VNS.debug.pos = wpos;
	VNS.debug.ext = wext;
	VNS.debug.parked = wparked;
}

// Anchor Y only exists after core's read pass, so cache it in arrange().
function arrangeWagons() {
	for (let i = 0; i < wn; i++) wy[i] = anchorYs[wels[i].__vnsAi];
}

function frameWagons() {
	if (!wn) return;
	for (let i = 0; i < wn; i++) wfree[i] = wy[i] - scrollY;
	wagonChain(wfree, wext, wpos, wn);
	VNS.debug.wet = 0;
	for (let i = 0; i < wn; i++) {
		wparked[i] = wagonParked(wfree, wpos, i);
		wagonExit(wpos[i], wdir[i], wscratch);
		let x = wscratch[0], y = wscratch[1];
		if (x !== 0 && (wdir[i] === DIR_LEFT || wdir[i] === DIR_RIGHT)) x = wagonLateral(x, wext[i], vw);
		if (y === wlastY[i] && x === wlastX[i]) continue;   // parked => zero style work
		VNS.debug.wet++;
		wlastY[i] = y;
		wlastX[i] = x;
		wels[i].style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
	}
}

// ------------------------------------------------------------------- morph

let sy = null, sbg = null, sfg = null, shas = null, srng = null, scls = null, spaint = null;
let sels = [], ssrcBg = null, ssrcFg = null, sn = 0, st = 0, smix = null, slast = null, srawr = null;
let sclsPrev = '', spaintPrev = '', smorphPrev = -1;

// 1 = colour, 2 = paint token, 0 = nothing declared.
function readColor(el, attr, arr, i) {
	const raw = el.getAttribute('data-' + attr);
	if (!raw) return 0;
	scratch4[0] = 0; scratch4[1] = 0; scratch4[2] = 0; scratch4[3] = 255;
	if (!parseColor(raw, scratch4)) return 2;
	const o = i << 2;
	arr[o] = scratch4[0]; arr[o + 1] = scratch4[1]; arr[o + 2] = scratch4[2]; arr[o + 3] = scratch4[3];
	return 1;
}

function measureStyle() {
	const found = document.querySelectorAll('[data-bg],[data-fg],[data-style]');
	const list = [];
	for (let i = 0; i < found.length; i++) {
		const el = found[i];
		if (el.classList.contains('vns-a')) continue;
		if (!ensureAnchor(el, 'vns-s')) continue;
		anchorIndexOf(el);
		list.push(el);
	}
	sels = sortByAnchorY(list);
	sn = sels.length;
	sy = new Float64Array(sn);
	sbg = new Uint8Array(sn << 2);
	sfg = new Uint8Array(sn << 2);
	shas = new Uint8Array(sn);
	srng = new Float64Array(sn);
	srawr = new Float64Array(sn);
	scls = new Array(sn);
	spaint = new Array(sn);
	ssrcBg = new Int32Array(sn).fill(-1);
	ssrcFg = new Int32Array(sn).fill(-1);
	smix = new Uint8Array(4);
	slast = new Int32Array(8).fill(-1);
	sclsPrev = '';
	spaintPrev = '';
	smorphPrev = -1;
	for (let i = 0; i < sn; i++) {
		const el = sels[i];
		scls[i] = (el.getAttribute('data-style') || '').trim().replace(/\s+/g, ' ');
		const raw = parseFloat(el.getAttribute('data-range'));
		srawr[i] = raw > 0 ? raw : 0;
		const b = readColor(el, 'bg', sbg, i);
		if (readColor(el, 'fg', sfg, i) === 1) shas[i] |= 2;
		if (b === 1) shas[i] |= 1;
		spaint[i] = b === 2 ? el.getAttribute('data-bg') : null;
	}
	// Hold semantics: a channel with no value at this anchor keeps the previous
	// one, so sparse marking works and a lerp toward undefined is impossible.
	for (let i = 0; i < sn; i++) {
		ssrcBg[i] = shas[i] & 1 ? i : i > 0 ? ssrcBg[i - 1] : -1;
		ssrcFg[i] = shas[i] & 2 ? i : i > 0 ? ssrcFg[i - 1] : -1;
	}
	VNS.style = { n: sn, els: sels, y: sy, t: 0 };
	VNS.debug.styleN = sn;
}

// Y is only valid after core's single read pass, so ranges (which depend on the
// gap to the previous anchor) are resolved here, not in measure().
function arrangeStyle() {
	for (let i = 0; i < sn; i++) {
		sy[i] = anchorYs[sels[i].__vnsAi];
		// A morph never exceeds the interval it lives in, or t could not reach 1
		// by the next anchor and the colour would snap at the boundary.
		const gap = i > 0 ? num(sy[i] - sy[i - 1], 1) : vh * 0.6;
		srng[i] = srawr[i] > 0 ? Math.min(srawr[i], gap) : num(Math.min(gap, vh * 0.6), 1);
	}
}

// A channel lerps only when both neighbouring segments have a colour of their
// own; otherwise it holds, so an anchor that omits data-bg never flashes.
function channelColor(prop, arr, ca, cb, t, slot) {
	if (ca < 0 && cb < 0) return;
	if (ca < 0) { mixColor4(smix, arr, cb, cb, 0); writeColor(prop, slot); return; }
	if (cb < 0 || ca === cb) { mixColor4(smix, arr, ca, ca, 0); writeColor(prop, slot); return; }
	mixColor4(smix, arr, ca, cb, t);
	writeColor(prop, slot);
}

function writeColor(prop, slot) {
	const r = smix[0], g = smix[1], b = smix[2], a = smix[3];
	if (r === slast[slot] && g === slast[slot + 1] && b === slast[slot + 2] && a === slast[slot + 3]) return;
	slast[slot] = r; slast[slot + 1] = g; slast[slot + 2] = b; slast[slot + 3] = a;
	const v = a === 255
		? 'rgb(' + r + ',' + g + ',' + b + ')'
		: 'rgba(' + r + ',' + g + ',' + b + ',' + ((a * 100 / 255) | 0) / 100 + ')';
	root.style.setProperty(prop, v);
}

function applyClasses(str) {
	if (str === sclsPrev) return;
	const rem = sclsPrev ? sclsPrev.split(' ') : null;
	for (let i = 0; rem && i < rem.length; i++) if (rem[i]) root.classList.remove(rem[i]);
	const add = str ? str.split(' ') : null;
	for (let i = 0; add && i < add.length; i++) if (add[i]) root.classList.add(add[i]);
	sclsPrev = str;
}

function frameStyle() {
	if (!sn) return;
	const c = scrollY + vh * 0.5;
	const i = lastIndexLE(sy, sn, c);
	let a = i, b = i, t = 1;
	if (i < 0) { a = 0; b = 0; }
	else if (i < sn - 1) { b = i + 1; t = ease((c - (sy[b] - srng[b])) / srng[b]); }
	st = t;
	VNS.style.t = t;
	channelColor('--vns-bg', sbg, ssrcBg[a], ssrcBg[b], t, 0);
	channelColor('--vns-fg', sfg, ssrcFg[a], ssrcFg[b], t, 4);
	applyClasses(scls[i < 0 ? 0 : i]);
	const pt = i >= 0 ? spaint[i] : null;
	const paint = t >= 1 && pt ? pt : '';
	if (paint !== spaintPrev) {
		spaintPrev = paint;
		if (paint) root.style.setProperty('--vns-bg', paint);
	}
	const q = (t * 64) | 0;
	if (q === smorphPrev) return;
	smorphPrev = q;
	root.style.setProperty('--vns-t', q / 64);
}

// ------------------------------------------------------------------ events

let eels = [], efn = [], enext = [], ehead = null, ey = null, eh = null, eflag = null;
let ewag = null, en = 0;
const estep = new Int32Array(2);
const detail = { el: null, event: '', y: 0, scrollY: 0, wagon: -1, morph: 0 };

function measureEvents() {
	const found = document.querySelectorAll('script[type="txt"]');
	const list = [];
	for (let i = 0; i < found.length; i++) {
		const el = found[i];
		if (!ensureAnchor(el, 'vns-e')) continue;
		anchorIndexOf(el);
		list.push(el);
	}
	eels = sortByAnchorY(list);
	en = eels.length;
	ey = new Float64Array(en);
	eh = new Float64Array(en);
	eflag = new Uint8Array(en);
	ewag = new Int32Array(en).fill(-1);
	ehead = new Int32Array(en * EVK).fill(-1);
	efn = [];
	const links = [];
	for (let i = 0; i < en; i++) {
		const el = eels[i];
		// A script has no box, so `end` means its own line left the top: the
		// author moves the trigger by moving the tag. No section heuristics.
		eh[i] = 0;
		const code = (el.textContent || '').trim();
		if (!code) continue;
		let fn = null;
		try { fn = new Function('VNS', 'detail', code); }
		catch (err) { console.error('VNS: event script does not compile:', err.message); continue; }
		const kinds = (el.getAttribute('event') || 'view').split(/[,\s]+/);
		for (let k = 0; k < kinds.length; k++) {
			const ev = kinds[k] ? EV_NAME.indexOf(kinds[k]) : -1;
			if (ev < 0) { console.error('VNS: unknown event "' + kinds[k] + '"'); continue; }
			links.push(ehead[i * EVK + ev]);
			ehead[i * EVK + ev] = efn.length;
			efn.push(fn);
		}
	}
	enext = new Int32Array(links.length);
	for (let i = 0; i < links.length; i++) enext[i] = links[i];
	VNS.events = { n: en, els: eels, y: ey, flags: eflag, wagon: ewag };
	VNS.debug.eventN = en;
}

// Wagon association and the no-burst-on-load latch both need measured Y, so
// they run in arrange() — after wagons.arrange() filled wy[].
function arrangeEvents() {
	for (let i = 0; i < en; i++) {
		ey[i] = anchorYs[eels[i].__vnsAi];
		if (wn) ewag[i] = lastIndexLE(wy, wn, ey[i] + 0.5);
		const p = VNS.options.replay ? 0 : (ewag[i] >= 0 && wn && wparked[ewag[i]] ? E_PARKED : 0);
		const e = eventEdges(ey[i] - scrollY, eh[i], vh, 0);
		eflag[i] = p | e | (e & E_END ? E_SKIP : 0);
	}
}

// Only called for a bit that actually fired, and it fills one reused frozen
// record instead of allocating an event payload per fire.
function fireEv(kind, i) {
	const first = ehead[i * EVK + kind];
	if (first < 0) return;                    // no script for this kind: not a fire
	const name = EV_NAME[kind];
	detail.el = eels[i];
	detail.event = name;
	detail.y = ey[i];
	detail.scrollY = scrollY;
	detail.wagon = ewag[i];
	detail.morph = st;
	let m = first;
	while (m >= 0) {
		try { efn[m](VNS, detail); }
		catch (err) { console.error('VNS ' + name + ' script threw:', err); }
		VNS.stats.fires[kind]++;
		m = enext[m];
	}
	eels[i].dataset.vnsLast = name;
}

function frameEvents() {
	if (!en) return;
	const hs = VNS.options.hysteresis;
	const alias = VNS.options.parkedAsView;
	for (let i = 0; i < en; i++) {
		const d = ey[i] - scrollY;
		const w = ewag[i];
		let p = w >= 0 && wn ? wparked[w] : alias ? 1 : 0;
		const step = eventStep(eflag[i], eventEdges(d, eh[i], vh, p), d, vh, hs, estep);
		if (step[0] !== eflag[i]) eflag[i] = step[0];
		const fire = step[1];
		if (!fire) continue;
		if (fire & E_VIEW) fireEv(0, i);
		if (fire & E_CENTER) fireEv(1, i);
		if (fire & E_PARKED) fireEv(2, i);
		if (fire & E_END) fireEv(3, i);
		if (fire & E_SKIP) fireEv(4, i);
	}
}

// A disabled engine must be inert: every entry point no-ops until boot, so a
// host page can keep calling VNS.refresh() unconditionally.
VNS.use = function (ctl) { if (VNS.booted) subs[subn++] = ctl; };
VNS.refresh = function () { if (!VNS.booted || busy) return; measuring = 1; poke(); };
VNS.step = function () { if (!VNS.booted) return; if (measuring) { measuring = 0; measureAll(); } frameAll(); };
VNS.anchorY = function (el) { return VNS.booted && el.__vnsAi >= 0 ? anchorYs[el.__vnsAi] : 0; };

// -------------------------------------------------------------------- boot

function boot() {
	if (VNS.booted) return;
	VNS.booted = 1;
	root = document.documentElement;
	injectCSS();
	layer = document.createElement('div');
	layer.id = 'vns-layer';
	document.body.appendChild(layer);
	// Registration order is frame order: wagons resolve pos[] first, then morph
	// paints, then events read both. One loop, one read phase, no duplication.
	if (VNS.options.wagons) VNS.use({ measure: measureWagons, arrange: arrangeWagons, frame: frameWagons });
	// consumers (harness, events) read VNS.wagons unconditionally: an empty
	// record is a better contract than an undefined one
	else VNS.wagons = { n: 0, els: [], y: [], free: [], pos: [], ext: [], parked: [], dir: [] };
	if (VNS.options.morph) VNS.use({ measure: measureStyle, arrange: arrangeStyle, frame: frameStyle });
	if (VNS.options.events) VNS.use({ measure: measureEvents, arrange: arrangeEvents, frame: frameEvents });
	window.addEventListener('scroll', poke, { passive: true });
	window.addEventListener('resize', function () { measuring = 1; poke(); }, { passive: true });
	window.addEventListener('orientationchange', function () { measuring = 1; poke(); }, { passive: true });
	window.addEventListener('load', poke, { passive: true });
	if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { VNS.refresh(); });
	measuring = 1;
	VNS.step();
}

if (typeof location !== 'undefined') {
	applyFlags();
	if (VNS.options.engine && typeof document !== 'undefined') {
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
		else boot();
	}
}

VNS.pure = {
	clamp01: clamp01, ease: ease, lastIndexLE: lastIndexLE, wagonChain: wagonChain,
	wagonParked: wagonParked, wagonExit: wagonExit, wagonLateral: wagonLateral, parseColor: parseColor, parseHex: parseHex,
	mixColor4: mixColor4, eventEdges: eventEdges, eventStep: eventStep, S2L: S2L, L2S: L2S,
	E_VIEW: E_VIEW, E_CENTER: E_CENTER, E_PARKED: E_PARKED, E_END: E_END, E_SKIP: E_SKIP,
	DIR_TOP: DIR_TOP, DIR_LEFT: DIR_LEFT, DIR_RIGHT: DIR_RIGHT, DIR_BOTTOM: DIR_BOTTOM
};

if (typeof module !== 'undefined' && module.exports) module.exports = VNS;
