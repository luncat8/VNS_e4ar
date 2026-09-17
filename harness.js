// harness.js — VNS dev/QA surface: content generator, diagnostics, auto-scroll,
// acceptance probes. Works with the engine absent; never assumes `VNS` exists.

const $ = (id) => document.getElementById(id);

let app = null;
let HLOG = [], seed = 1, rnd = Math.random;
let qaRows = [], qaRunning = 0, autoTimer = 0, autoSpeed = 6, regenMs = 0, lastFrames = 0, fps = 0, diagTick = 0, panelH = 0;

const PAL = [
	{ L: 'R', c: '#d92b1f', soft: '#ffb3a8', g: 'linear-gradient(165deg,#ff7a6b,#6e0d06)' },
	{ L: 'B', c: '#1d5bd0', soft: '#a9c8ff', g: 'linear-gradient(115deg,#7fb1ff,#071a4d)' },
	{ L: 'G', c: '#1d8f4c', soft: '#a8e9bf', g: 'linear-gradient(20deg,#84e7a6,#06381b)' },
	{ L: 'Y', c: '#c99500', soft: '#ffe9a0', g: 'radial-gradient(circle at 32% 28%,#ffe680,#7c5800)' },
	{ L: 'P', c: '#7a34c0', soft: '#dcb8ff', g: 'linear-gradient(135deg,#cfa0ff,#2c0a52)' },
	{ L: 'C', c: '#5c5c5c', soft: '#d2d2d2', g: 'repeating-conic-gradient(#3a3a3a 0% 25%,#e6e6e6 0% 50%)', sz: '72px 72px' }
];
const MODES = ['cover', 'tiled', 'contain', 'fixed', 'auto'];
const DIRS = ['top', 'left', 'right', 'bottom'];
const CLASSES = ['day', 'dusk', 'night', 'fog'];
const LINES = { tiny: 18, mono: 64, huge: 220 };
const NUMERIC = { n: 1, style: 1, events: 1, stat: 1, wire: 1, bad: 1, nonce: 1 };

const PRESETS = {
	mixed: { n: 6, len: 'mono', gap: 'mixed', mode: 'mixed', size: 'mixed', dir: 'mixed', nest: 'both', style: 1, events: 1, stat: 1, bad: 0 },
	mono: { n: 6, len: 'mono', gap: 'same', mode: 'cover', size: '512', dir: 'none', nest: 'section', style: 1, events: 1, stat: 0, bad: 0 },
	tight: { n: 8, len: 'tiny', gap: 'zero', mode: 'mixed', size: '1024', dir: 'none', nest: 'flat', style: 0, events: 0, stat: 0, bad: 0 },
	long: { n: 12, len: 'huge', gap: 'huge', mode: 'cover', size: '1024', dir: 'mixed', nest: 'both', style: 1, events: 1, stat: 1, bad: 0 },
	draft: { n: 1, len: 'mono', gap: 'same', mode: 'cover', size: '512', dir: 'none', nest: 'section', style: 0, events: 1, stat: 1, bad: 0 }
};

let cfg = { preset: 'mixed', nonce: 0, n: 6, len: 'mono', gap: 'mixed', mode: 'mixed', size: 'mixed', dir: 'mixed', nest: 'both', style: 1, events: 1, stat: 1, wire: 0, bad: 0 };

// ------------------------------------------------------------------- utils

// Deterministic: one hash rebuilds one identical document, so a bug report is
// just the URL — no "it looked fine on my screen".
function mulberry(a) {
	return function () {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

function hashStr(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

function pick(list) { return list[(rnd() * list.length) | 0]; }

const IDS = ['preset', 'n', 'len', 'gap', 'mode', 'size', 'dir', 'nest', 'style', 'events', 'stat', 'wire', 'bad'];

function readHash() {
	const q = location.hash.replace(/^#/, '');
	if (!q) return;
	for (const part of q.split('&')) {
		const kv = part.split('='), k = kv[0], v = decodeURIComponent(kv[1] === undefined ? '' : kv[1]);
		if (cfg[k] === undefined || !v) continue;
		cfg[k] = NUMERIC[k] ? +v : v;
	}
	if (PRESETS[cfg.preset]) cfg = Object.assign({}, PRESETS[cfg.preset], { preset: cfg.preset }, readOver(q));
}

// A preset may be overridden by explicit params after it.
function readOver(q) {
	const over = {};
	for (const part of q.split('&')) {
		const kv = part.split('='), k = kv[0];
		if (cfg[k] === undefined || k === 'preset') continue;
		over[k] = NUMERIC[k] ? +kv[1] : decodeURIComponent(kv[1]);
	}
	return over;
}

function writeHash() {
	const out = [];
	for (const k in cfg) out.push(k + '=' + cfg[k]);
	const h = '#' + out.join('&');
	try { history.replaceState(null, '', h); } catch (e) { location.hash = out.join('&'); }
}

// Inline SVG with explicit width/height: size is known synchronously, so 0.2
// never waits on an image decode, and no network request exists. Returns the bare
// URI, not url(...): percent-encoding leaves no quotes in the payload, so the
// caller can wrap it in url('...') without ending the style="..." attribute.
function svgURI(w, h, pal, idx, note) {
	const ticks = [];
	for (let i = 1; i * 64 < w; i++) ticks.push('<path d="M' + (i * 64) + ' 0v' + (i % 2 ? 44 : 96) + '"/>');
	const s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
		+ '<defs><pattern id="c" width="128" height="128" patternUnits="userSpaceOnUse">'
		+ '<rect width="128" height="128" fill="' + pal.c + '"/><rect width="64" height="64" fill="' + pal.soft + '"/>'
		+ '<rect x="64" y="64" width="64" height="64" fill="' + pal.soft + '"/></pattern></defs>'
		+ '<rect width="' + w + '" height="' + h + '" fill="url(#c)"/>'
		+ '<g stroke="' + pal.c + '" stroke-width="4" opacity=".55">' + ticks.join('') + '</g>'
		+ '<g fill="#fff" font-family="ui-monospace,monospace" font-weight="700">'
		+ '<text x="12" y="52" font-size="46">' + idx + '</text>'
		+ '<text x="' + (w - 12) + '" y="52" font-size="24" text-anchor="end">' + note + '</text>'
		+ '<text x="' + (w >> 1) + '" y="' + (h >> 1) + '" font-size="' + (Math.min(w, h) >> 1) + '" text-anchor="middle" opacity=".3">' + pal.L + '</text>'
		+ '<text x="12" y="' + (h - 16) + '" font-size="24">' + w + '×' + h + '</text></g>'
		+ '<rect x="2" y="2" width="' + (w - 4) + '" height="' + (h - 4) + '" fill="none" stroke="#fff" stroke-width="4"/></svg>';
	return "data:image/svg+xml," + encodeURIComponent(s);
}

// ------------------------------------------------------------------ markup

function bgHTML(idx, pal, mode, size, dir, extra) {
	const note = mode + ((mode === 'fixed' || mode === 'auto' || mode === 'tiled') ? ' ' + size : '');
	// tiled paints an image the box can repeat, so it gets the SVG like
	// fixed/auto, never a gradient (a gradient fills its box once and does not
	// tile). The tile size is the image size — no data-size needed.
	const svg = mode !== 'cover' && mode !== 'contain';
	const img = svg ? "url('" + svgURI(size, size, pal, idx, note) + "')" : pal.g;
	const tile = !svg && pal.sz ? ';background-size:' + pal.sz : ';';
	const a = ['class="bg" data-mode="' + mode + '"'];
	if (mode === 'fixed' || mode === 'auto') a.push('data-size="' + size + '"');
	if (dir !== 'top') a.push('data-dir="' + dir + '"');
	if (cfg.style) a.push('data-bg="' + pal.soft + '"');
	if (extra) a.push(extra);
	const stat = extra && extra.indexOf('data-static') >= 0;
	return '<div ' + a.join(' ') + ' style="background-image:' + img + tile + '"><b class="bgl">bg ' + idx + ' · ' + note
		+ (dir !== 'top' ? ' → ' + dir : '')
		+ (stat ? ' · static, not a wagon' : '') + '</b></div>';
}

function textHTML(k, from, count) {
	const out = [];
	for (let i = 0; i < count; i++) {
		const n = from + i;
		out.push('<span class="l">' + k + '·' + n + '</span>');
		if (n % 25 === 24) out.push('<i class="r">y' + n + '</i>');
		if (i + 1 < count) out.push('<br>');
	}
	return out.join('');
}

function runHTML(pal, count) {
	const out = [];
	for (let i = 0; i < count; i++) out.push('<b class="run" style="color:' + pal.c + '">' + pal.L + '</b>');
	return out.join('<br>');
}

function ev(tag, body) {
	return '<script type="txt" event="' + tag + '">' + body + '</' + 'script>';
}

function eventsHTML(k, where) {
	if (!cfg.events) return '';
	const log = (m) => 'VNSlog("' + m + '");document.documentElement.dataset.last="' + m + '"';
	if (where === 'start') return ev('view', log(k + ' view')) + ev('center', log(k + ' center'));
	if (where === 'bg') return ev('parked', log(k + ' parked'));
	let s = ev('end', log(k + ' end')) + ev('skip', log(k + ' SKIP') + ';document.documentElement.dataset.skipped=' + k);
	if (cfg.bad) s += ev('view', 'let = oops;') + ev('nope', 'VNSlog("never")');
	return s;
}

function styleAttrs(pal, i) {
	if (!cfg.style) return '';
	return ' data-bg="' + pal.c + '" data-fg="' + (i % 4 === 2 ? '#f4f1ea' : '#141210') + '" data-style="'
		+ CLASSES[i % CLASSES.length] + '" data-range="' + (i % 3 === 0 ? 120 : i % 3 === 1 ? 460 : 0) + '"';
}

function chapterHTML(k, bgIdx) {
	const pal = PAL[k % PAL.length];
	const mode = cfg.mode === 'mixed' ? pick(MODES) : cfg.mode;
	const size = cfg.size === 'mixed' ? pick([256, 512, 1024]) : +cfg.size;
	const dir = cfg.dir === 'mixed' ? (k % 4 === 3 ? pick(DIRS) : 'top')
		: (DIRS.indexOf(cfg.dir) >= 0 ? cfg.dir : 'top');
	const lines = LINES[cfg.len] + (cfg.gap === 'mixed' ? (rnd() * 48 | 0) : 0);
	const gap = cfg.gap === 'zero' ? 0 : cfg.gap === 'same' ? 6 : cfg.gap === 'huge' ? 60 + (rnd() * 40 | 0) : 2 + (rnd() * 26 | 0);
	const flat = cfg.nest === 'flat' || (cfg.nest === 'both' && k % 2 === 0);
	const out = [];
	if (!flat) out.push('<section class="ch"' + styleAttrs(pal, k) + '>');
	out.push('<h4 class="n" data-k="' + k + '"' + (flat ? styleAttrs(pal, k) : '') + '>' + k
		+ '<small>' + (flat ? 'flat' : 'section') + ' · ' + mode + (mode === 'fixed' || mode === 'auto' ? ' ' + size : '')
		+ (dir !== 'top' ? ' →' + dir : '') + ' · ' + lines + ' ln · gap ' + gap + '</small></h4>');
	out.push(eventsHTML(k, 'start'));
	out.push(textHTML(k, 0, gap));
	if (gap) out.push('<br>');
	out.push(bgHTML(bgIdx.i++, pal, mode, size, dir));
	out.push(eventsHTML(k, 'bg'));
	out.push('<br>' + runHTML(pal, 3) + '<br>');
	const half = lines >> 1;
	out.push(textHTML(k, gap, half));
	// free placement: another wagon dropped between two text lines. data-static
	// is the author opt-out, so the generator emits both kinds.
	if (cfg.gap !== 'zero' && k % 3 === 1) out.push('<br>' + bgHTML(bgIdx.i++, pal, cfg.mode === 'mixed' ? pick(MODES) : mode, size, 'top', 'data-static') + '<br>');
	out.push(textHTML(k, gap + half, lines - half));
	out.push(eventsHTML(k, 'end'));
	if (!flat) out.push('</section>');
	if (cfg.stat && k % 3 === 2) out.push('<div class="bgwindow" style="background-image:url(\'' + svgURI(512, 256, pal, k, 'in-flow') + '\')"><b class="bgl">.bgwindow · never a wagon</b></div>');
	return out.join('');
}

// The draft's own snippet, so the DOM contract is tested against what was asked
// for and not only against what the generator likes to emit.
function draftHTML() {
	const bg = (n, img, mode, extra) => '<div class="bg" data-mode="' + mode + '" ' + (extra || '') + ' style="background-image:' + img
		+ '"><b class="bgl">bg ' + n + ' · ' + mode + '</b></div>';
	const g = PAL.map((p) => p.g);
	const uri = (w, h, pal, i, note) => "url('" + svgURI(w, h, pal, i, note) + "')";
	return '<section class="ch"><h4 class="n" data-k="1"><small>draft snippet, verbatim shape</small></h4>'
		+ bg(1, g[0], 'cover') + '1<br>1<br>any text and sections combinations with free placement of background-image and scripts in anywhere<br>1<br>'
		+ bg(2, g[1], 'cover') + '2<br>2<br>2<br>2<br>2<br>2<br>2<br>'
		+ bg(3, uri(1024, 1024, PAL[2], 3, 'fixed 1024'), 'fixed', 'data-dir="left" data-size="1024"') + '3<br>3<br>'
		+ '<section><h2>3</h2><div class="bgwindow" style="background-image:' + uri(512, 512, PAL[3], 3, 'in-flow') + '">'
		+ ev('view', 'VNSlog("3 view")') + ev('center', 'VNSlog("3 center")')
		+ ev('end', 'VNSlog("3 out")') + ev('skip', 'VNSlog("3 skip")') + '3<br>3<br></div>3<br>3<br></section>'
		+ bg(4, g[4], 'contain') + '4<br>4<br></section>';
}

function build() {
	const t0 = performance.now();
	seed = hashStr(location.hash) || 1;
	rnd = mulberry(seed);
	const bgIdx = { i: 1 };
	const out = [];
	if (cfg.preset === 'draft') out.push(draftHTML());
	else for (let k = 1; k <= cfg.n; k++) out.push(chapterHTML(k, bgIdx));
	// Without a tail the last wagon can never reach the top edge: that is a
	// property of the document, and must not be mistaken for a park bug.
	out.push('<div class="tail"><span>tail · one screen tall, so the last wagon gets to park</span></div>');
	app.innerHTML = out.join('');
	regenMs = performance.now() - t0;
	if (window.VNS) VNS.refresh();
}

// ------------------------------------------------------------ diagnostics

function engineOn() { return !!(window.VNS && VNS.booted); }

function engineState() {
	const w = engineOn() ? VNS.debug : null;
	if (!w || !w.n) return { n: 0, parked: 0, active: -1, pushed: 0, wet: 0 };
	let parked = 0, active = -1, pushed = 0;
	for (let i = 0; i < w.n; i++) {
		if (w.parked[i]) parked++;
		if (w.pos[i] < -0.5) pushed++;
		if (w.free[i] <= 0) active = i;
	}
	return { n: w.n, parked: parked, active: active, pushed: pushed, wet: w.wet };
}

function diag() {
	const s = engineState();
	const st = engineOn() ? VNS.stats : { frames: 0, fires: [0, 0, 0, 0, 0] };
	if (diagTick % 5 === 0) fps = (st.frames - lastFrames) / 0.5;
	lastFrames = st.frames;
	diagTick++;
	const o = engineOn() ? VNS.options : {};
	const f = st.fires;
	$('dstats').textContent = [
		'scrollY ' + Math.round(window.scrollY) + '   vh ' + innerHeight + '   doc ' + document.documentElement.scrollHeight,
		'morph t ' + (engineOn() && VNS.style ? VNS.style.t.toFixed(2) : '—') + '   wagons ' + s.n + '   active ' + s.active + '   parked ' + s.parked + '   pushed ' + s.pushed + '   writes/frame ' + s.wet,
		'engine ' + (engineOn() ? 'on' : 'OFF (?engine=0) · .bg fall back behind the text') + '   frames/s ' + Math.round(fps) + '   regen ' + regenMs.toFixed(1) + 'ms',
		window.VNS ? 'flags wagons=' + o.wagons + ' morph=' + o.morph + ' events=' + o.events + '   anchors: style ' + (VNS.debug.styleN || 0) + '  script ' + (VNS.debug.eventN || 0) : '',
		window.VNS ? 'fired  view ' + f[0] + '  center ' + f[1] + '  parked ' + f[2] + '  end ' + f[3] + '  skip ' + f[4] : '',
		'last event: ' + (HLOG.length ? HLOG[HLOG.length - 1] : '—') + '   seed ' + seed
	].filter(Boolean).join('\n');
	// Below 1100px the panels are in-flow: when they change height (first tick
	// fills #dstats, QA rows paint) they shift #app and every anchor with it.
	// Re-measure on actual height change only, so an idle page stays idle.
	if (window.VNS) {
		const h = panelHeight();
		if (h !== panelH) { panelH = h; VNS.refresh(); }
	}
	$('rail').style.backgroundPositionY = -Math.round(window.scrollY) + 'px';
	$('mark').textContent = Math.round(window.scrollY);
	if (cfg.wire) wires();
}

function wires() {
	const w = engineOn() ? VNS.debug : null;
	if (!w || !w.n) { $('wires').innerHTML = ''; return; }
	const out = [];
	for (let i = 0; i < w.n; i++) {
		const r = w.els[i].getBoundingClientRect();
		out.push('<i class="wbox" style="left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px"></i>'
			+ '<i class="want" style="top:' + (w.y[i] - window.scrollY) + 'px"><b>' + i + ' y' + Math.round(w.pos[i])
			+ ' free ' + Math.round(w.free[i]) + ' h' + Math.round(w.ext[i]) + (w.parked[i] ? ' PARKED' : '') + '</b></i>');
	}
	$('wires').innerHTML = out.join('');
}

// -------------------------------------------------------------- QA probes
// Probes read the engine's own arrays and inline transform strings: no computed
// style, no getComputedStyle in the loop, and results are not smoothed by CSS.

function wagonList() { return window.VNS && VNS.wagons && VNS.wagons.n ? VNS.wagons : null; }

// Every measure() publishes a FRESH VNS.wagons record (new arrays). A
// refresh() consumed between two probe steps — a resize, fonts.ready, a panel
// change — therefore invalidates any captured reference: reading it then mixes
// two geometries (targets from one, pos from another), which is exactly how
// anchorAlign once reported a 62px riding error the chain math cannot produce.
// Every read must be paired with the record the engine just stepped.
function curWagons(fallback) { return wagonList() || fallback; }

// Settle where fn(record) points, and return the record the engine just
// stepped. If a refresh() is consumed inside the step — a panel height change,
// a resize, fonts.ready — the engine re-measures and the target derived from
// the old record is stale: re-derive it from the fresh record and settle
// again. Bounded: a refresh means the layout actually changed, so it settles.
async function settleWhere(fn, fallback) {
	let w = wagonList() || fallback;
	let target = fn(w);
	for (let t = 0; t < 3; t++) {
		await settle(target);
		const w2 = wagonList() || w;
		const next = fn(w2);
		w = w2;
		if (next === target) break;
		target = next;
	}
	return w;
}

function settle(y) {
	return new Promise((done) => {
		window.scrollTo(0, y);
		requestAnimationFrame(() => requestAnimationFrame(() => {
			if (window.VNS) VNS.step();
			done();
		}));
	});
}

function maxX() { return Math.max(1, document.documentElement.scrollHeight - innerHeight); }

function panelHeight() { return $('gen').offsetHeight + $('diag').offsetHeight; }

function row(name, ok, detail) {
	qaRows.push({ name: name, ok: ok, detail: detail || '' });
	console[ok ? 'info' : 'error']('VNS QA', ok ? 'PASS' : 'FAIL', name, detail || '');
	paintQA();
}

function paintQA() {
	$('qa').innerHTML = qaRows.map((r) => '<div class="' + (r.ok ? 'pass' : 'fail') + '">' + (r.ok ? '✔ ' : '✘ ') + r.name
		+ (r.detail ? '<small>' + r.detail + '</small>' : '') + '</div>').join('') || '<div class="idle">QA: press q or click here</div>';
	if (window.VNS) {
		// Update the height baseline now. Waiting for diag() to notice this
		// asynchronous panel change lets it re-measure in the middle of a probe.
		panelH = panelHeight();
		VNS.refresh();
	}
}

function tfNum(t, axis) {
	const m = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(t || '');
	return m ? +(axis ? m[2] : m[1]) : 0;
}

async function qaReversibility() {
	let w = wagonList();
	if (!w) return row('reversibility', false, 'engine off or no wagons');
	const max = maxX(), ys = [], fwd = [], back = [], at = [];
	for (let i = 0; i < 10; i++) ys.push(Math.round(max * i / 9));
	for (const y of ys) { await settle(y); w = curWagons(w); fwd.push(w.els.map((el) => el.style.transform)); at.push(window.scrollY); }
	for (let i = ys.length - 1; i >= 0; i--) { await settle(ys[i]); w = curWagons(w); back.push(w.els.map((el) => el.style.transform)); at.push(window.scrollY); }
	let bad = 0, drift = 0;
	for (let i = 0; i < 10; i++) {
		const a = fwd[i], b = back[9 - i];
		drift = Math.max(drift, Math.abs(at[i] - ys[i]), Math.abs(at[19 - i] - ys[i]));
		for (let k = 0; k < a.length; k++) if (a[k] !== b[k] && (tfNum(a[k], 1) !== tfNum(b[k], 1) || tfNum(a[k], 0) !== tfNum(b[k], 0))) bad++;
	}
	// The scroll request itself must land where it was sent, or the two passes
	// did not even test the same positions. 1px tolerance: scrollTo snaps to
	// device pixels, so a zoomed viewport lands a fraction of a CSS px off
	// with nothing moving. Real drift means the page moved under the probe —
	// scroll anchoring after a layout shift, or another writer of scrollY.
	const shaky = drift > 1;
	row('reversibility · 10 positions down then up', bad === 0 && !shaky,
		(bad ? bad + ' differ' : 'identical transforms both ways')
		+ (shaky ? ' · scroll request landed ' + drift.toFixed(1) + 'px off — the page moved under the probe (scroll anchoring or concurrent scrolling)' : ''));
}

async function qaOverlap() {
	let w = wagonList();
	if (!w) return row('no overlap', false, 'engine off');
	const max = maxX();
	let bad = 0, n = 0, worst = 0;
	for (let i = 0; i < 10; i++) {
		await settle(Math.round(max * i / 9));
		w = curWagons(w);
		for (let k = 0; k + 1 < w.n; k++) {
			if (w.dir[k] !== 0) continue;                     // lateral and bottom exits are exempt
			n++;
			const over = w.pos[k] + w.ext[k] - w.pos[k + 1];
			if (over > worst) worst = over;
			if (over > 1) bad++;
		}
	}
	row('no overlap · ' + n + ' pairs at 10 scroll positions', n > 0 && bad === 0, bad + ' bad, worst ' + worst.toFixed(1) + 'px');
}

async function qaAnchor() {
	const w0 = wagonList();
	if (!w0) return row('anchor alignment', false, 'engine off');
	let tested = 0, bad = 0, skipped = 0, worst = 0;
	for (let i = 0; i < w0.n; i++) {
		const w = wagonList() || w0;
		const max = maxX();
		const gapNext = i + 1 < w.n ? w.y[i + 1] - w.y[i] : 1e9;
		if (gapNext < w.ext[i]) { skipped++; continue; }    // coupled train: contact before parking
		if (w.y[i] > max) { skipped++; continue; }          // document too short to park
		// Targets derive from anchor Y, so both re-target if a re-measure lands
		// mid-check (see settleWhere).
		let rec = await settleWhere((r) => Math.max(0, Math.round(r.y[i] - 300)), w);
		tested++;
		worst = Math.max(worst, Math.abs(rec.pos[i] - 300));
		// ceil so free <= 0 even when the marker Y is a fraction of a pixel —
		// scrollTo snaps to integers, and parked is pos===0 && free<=0.
		rec = await settleWhere((r) => Math.min(maxX(), Math.ceil(r.y[i])), w);
		if (Math.abs(rec.pos[i]) > 1) bad++;
	}
	row('anchor alignment · riding y==300, parked y==0', tested > 0 && bad === 0 && worst <= 1,
		tested + ' tested, ' + skipped + ' skipped, worst riding error ' + worst.toFixed(2) + 'px');
}

// Legal motion while scrolling down: ride 1:1 (Δ = -step), stick (Δ = 0), or
// the single transition frame between them (Δ in (-step, 0)) when a wagon
// parks or starts being pushed. Anything outside that is a jump.
async function qaJump() {
	const w0 = wagonList();
	if (!w0) return row('frame jump', false, 'engine off');
	const end = maxX(), step = 8;
	await settle(0);
	let w = curWagons(w0), worst = 0, frames = 0;
	let prevPos = new Float64Array(w.n);
	for (let i = 0; i < w.n; i++) prevPos[i] = w.pos[i];
	for (let y = step; y <= end; y += step) {
		window.scrollTo(0, y);
		VNS.step();
		w = curWagons(w);
		if (prevPos.length !== w.n) {                     // a re-measure changed the fleet
			prevPos = new Float64Array(w.n);
			for (let i = 0; i < w.n; i++) prevPos[i] = w.pos[i];
		}
		frames++;
		for (let i = 0; i < w.n; i++) {
			if (w.dir[i] !== 0) continue;
			const d = w.pos[i] - prevPos[i];
			const dev = d > 0 ? d : Math.max(0, -d - step);
			if (dev > worst) worst = dev;
			prevPos[i] = w.pos[i];
		}
	}
	row('frame jump ≤ 1px · rides 1:1 or sticks', worst <= 1.01, 'worst ' + worst.toFixed(2) + 'px over ' + frames + ' steps');
}

async function qaEvents() {
	if (!window.VNS || !VNS.booted || !VNS.options.events) return row('script events', false, 'events off (?events=0)');
	const chapters = cfg.preset === 'draft' ? 1 : cfg.n;
	// Independent of earlier probes: re-latch as if the page had just loaded at top.
	await settle(0);
	VNS.refresh();
	VNS.step();
	VNS.stats.fires.fill(0);
	const max = maxX(), stepPx = Math.max(12, innerHeight >> 4);
	for (let y = 0; y < max; y += stepPx) await settle(y);
	await settle(max);
	// The first chapter is usually already on screen at s=0, so its view/center
	// latches are pre-consumed by the no-burst-on-load policy: allow one short.
	const f = VNS.stats.fires.slice();
	row('slow pass · view/center/end fire, no skip', f[0] >= Math.max(1, chapters - 1) && f[3] >= chapters && f[4] === 0, f.join('/'));
	if (wagonList()) row('slow pass · parked fires', f[2] > 0, 'parked ' + f[2]);
	// Flick from a fresh top — after a slow pass every latch is already consumed,
	// so skip would never appear.
	await settle(0);
	VNS.refresh();
	VNS.step();
	VNS.stats.fires.fill(0);
	window.scrollTo(0, max);
	VNS.step();
	const g = VNS.stats.fires.slice();
	if (chapters < 2) row('flick to bottom · needs 2+ chapters', true, 'skipped');
	else row('flick to bottom · skip fires and view does not', g[4] > 0 && g[0] === 0, g.join('/'));
	// Going back up must not repeat anything: `end`/`skip`/`parked` stay quiet.
	// `view` may fire again, but only for topics the flick skipped — an anchor
	// that was jumped over and is now actually on screen is being read for the
	// first time, which is the latched-state policy, not a re-fire.
	VNS.stats.fires.fill(0);
	await settle(0);
	VNS.step();
	const r = VNS.stats.fires.slice();
	row('reverse scroll · no end, no skip, no parked', r[2] === 0 && r[3] === 0 && r[4] === 0, r.join('/'));
	row('reverse scroll · view only re-fires for skipped topics', r[0] <= Math.max(1, g[4]), 'view ' + r[0] + ' vs skipped ' + g[4]);
	VNS.stats.fires.fill(0);
	await settle(0);
	const before = VNS.stats.frames;
	await new Promise((d) => setTimeout(d, 400));
	row('idle · engine runs no frames when nothing moves', VNS.stats.frames - before <= 1, 'frames in 400ms: ' + (VNS.stats.frames - before));
	await settle(0);
}

function setQARunning(on) {
	qaRunning = on ? 1 : 0;
	const b = $('qaBtn');
	const a = $('auto');
	if (b) {
		b.disabled = !!on;
		b.textContent = on ? 'QA running…' : 'QA all (q)';
		b.setAttribute('aria-busy', on ? 'true' : 'false');
	}
	if (a) a.disabled = !!on;
}

async function qaAll() {
	// Probes are async and all share scrollY, event latches and qaRows. A second
	// launch would race the first run and make both reports meaningless.
	if (qaRunning) return;
	// Stop before locking the controls: toggleAuto is deliberately inert while
	// QA owns the scroll position.
	if ($('auto').dataset.on === '1') toggleAuto();
	setQARunning(1);
	try {
		// Materialize the fixed-height diagnostic text before sampling. Otherwise
		// its first 10 Hz tick can move an in-flow panel during reversibility.
		diag();
		qaRows = [];
		paintQA();
		await qaReversibility();
		await qaOverlap();
		await qaAnchor();
		await qaJump();
		await qaEvents();
		const bad = qaRows.filter((r) => !r.ok).length;
		console.info('VNS QA ' + (qaRows.length - bad) + '/' + qaRows.length + ' pass');
		await settle(0);
	} finally {
		setQARunning(0);
	}
}

// -------------------------------------------------------------- interaction

function autoStep() {
	autoTimer = 0;
	if ($('auto').dataset.on !== '1') return;
	const max = maxX();
	window.scrollTo(0, window.scrollY >= max ? 0 : window.scrollY + autoSpeed);
	autoTimer = requestAnimationFrame(autoStep);
}

function toggleAuto() {
	if (qaRunning) return;
	const on = $('auto').dataset.on !== '1';
	$('auto').dataset.on = on ? '1' : '0';
	$('auto').textContent = on ? 'stop' : 'autoscroll';
	if (on && !autoTimer) autoTimer = requestAnimationFrame(autoStep);
}

function chapterY(k) {
	const hs = app.querySelectorAll('h4.n[data-k]');
	for (let i = 0; i < hs.length; i++) if (+hs[i].dataset.k === k) return hs[i].getBoundingClientRect().top + window.scrollY - 8;
	return -1;
}

function gotoChapter(k) {
	const y = chapterY(k);
	if (y >= 0) window.scrollTo(0, y);
	$('jump').value = k < 1 ? 1 : k > cfg.n ? cfg.n : k;
}

function syncForm() {
	for (const id of IDS) {
		const el = $(id);
		if (!el) continue;
		if (el.type === 'checkbox') el.checked = !!cfg[id];
		else el.value = cfg[id];
	}
	$('nO').textContent = cfg.n;
	paintQA();
}

function applyForm() {
	const prevPreset = cfg.preset;
	for (const id of IDS) {
		const el = $(id);
		if (!el) continue;
		if (el.type === 'checkbox') cfg[id] = el.checked ? 1 : 0;
		else cfg[id] = NUMERIC[id] ? +el.value : el.value;
	}
	// A named preset is a starting point. Re-explode it only when the preset
	// itself changes — otherwise data-dir=right (and every other override) is
	// silently wiped on regen.
	if (PRESETS[cfg.preset] && cfg.preset !== prevPreset)
		cfg = Object.assign({}, PRESETS[cfg.preset], { preset: cfg.preset, wire: cfg.wire, nonce: cfg.nonce });
	syncForm();
	writeHash();
}

function regen(resetScroll) {
	build();
	if (resetScroll) window.scrollTo(0, 0);
	if (window.VNS) VNS.refresh();
}

// Search carries the engine flag, hash carries the story: both survive the
// reload, so "same story, engine off" is one click. The engine reads search
// before hash, so ?events=0 wins over the hash's events=1.
function reloadWithEngine(mode) {
	const map = { all: '', nowagons: 'wagons=0', nomorph: 'morph=0', noevents: 'events=0', off: 'engine=0' };
	const q = map[mode];
	location.href = location.pathname + (q ? '?' + q : '') + location.hash;
}

// Called by generated event scripts; also the author-facing sample API.
function VNSlog(msg) {
	HLOG.push(msg);
	if (HLOG.length > 400) HLOG.shift();
	if ($('last')) $('last').textContent = msg;
}

function boot() {
	app = $('app');
	window.VNSlog = VNSlog;
	readHash();
	syncForm();
	build();
	setInterval(diag, 100);
	$('gen').addEventListener('submit', (e) => e.preventDefault());
	$('gen').addEventListener('change', (e) => {
		if (e.target.id === 'eng') return reloadWithEngine(e.target.value);
		applyForm();
		if (e.target.id === 'wire') { if (!cfg.wire) $('wires').innerHTML = ''; return; }
		regen(true);
	});
	$('gen').addEventListener('input', (e) => {
		if (e.target.type !== 'range') return;
		cfg.n = +e.target.value;
		$('nO').textContent = cfg.n;
	});
	$('reg').addEventListener('click', () => { applyForm(); regen(true); });
	$('seed').addEventListener('click', () => { cfg.nonce++; applyForm(); regen(true); });
	$('top').addEventListener('click', () => window.scrollTo(0, 0));
	$('bot').addEventListener('click', () => window.scrollTo(0, maxX()));
	$('next').addEventListener('click', () => gotoChapter((+$('jump').value || 0) + 1));
	$('prev').addEventListener('click', () => gotoChapter((+$('jump').value || 0) - 1));
	$('auto').addEventListener('click', toggleAuto);
	$('speed').addEventListener('input', (e) => { autoSpeed = +e.target.value; $('spd').textContent = autoSpeed; });
	$('qaBtn').addEventListener('click', qaAll);
	addEventListener('resize', () => { if (window.VNS) VNS.refresh(); });
	addEventListener('keydown', (e) => {
		if (e.target.matches('input,select,textarea')) return;
		const k = e.key.toLowerCase();
		if (k === ' ') { e.preventDefault(); toggleAuto(); }
		else if (k === 'r') $('reg').click();
		else if (k === 'q') qaAll();
		else if (k === 't') window.scrollTo(0, 0);
		else if (k === 'b') window.scrollTo(0, maxX());
		else if (k === 'w') { $('wire').checked = cfg.wire = cfg.wire ? 0 : 1; if (!cfg.wire) $('wires').innerHTML = ''; }
		else if (k === 'arrowdown') gotoChapter((+$('jump').value || 0) + 1);
		else if (k === 'arrowup') gotoChapter((+$('jump').value || 0) - 1);
	});
	console.info('VNS harness · seed ' + seed + ' · keys: space autoscroll, q QA, w wireframes, r regen, t/b top/bottom');
}

if (typeof window !== 'undefined') {
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
	else boot();
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PAL: PAL, mulberry: mulberry, hashStr: hashStr, svgURI: svgURI };
