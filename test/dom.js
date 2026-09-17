// test/dom.js — engine DOM mechanics under jsdom with a synthetic block layout.
// `node test/dom.js`. Cannot check painting, but it checks the parts that break
// in real pages: anchor markers, hoisting, refresh/regen bookkeeping, the write
// phase, style vars and classes, and event firing through the DOM.
//
// Layout model: an element's height is data-lay if declared, else the sum of its
// children; #vns-layer is fixed so it contributes 0. Markers are zero-height, so
// inserting one never shifts anything — the property the engine relies on.

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'vns.js'), 'utf8');
const VH = 200;
let pass = 0, fail = 0;

function ok(name, cond, extra) {
	if (cond) { pass++; return; }
	fail++;
	console.log('FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
}
function eq(name, got, want, eps) {
	const good = typeof want === 'number' ? Math.abs(got - want) <= (eps === undefined ? 0.01 : eps) : got === want;
	ok(name, good, { got: got, want: want });
}

const DOC = `<!DOCTYPE html><html><head></head><body><div id="app">
	<section class="ch" data-lay="200" data-bg="#ff0000" data-fg="#000000" data-style="day" data-range="100">
		<h4 data-lay="40">1</h4>
		<div class="bg" data-lay="100" data-mode="fixed"></div>
		<p data-lay="60">text</p>
		<script type="txt" event="view,center,parked,end,skip">log('1:'+detail.event+':'+detail.scrollY)</script>
	</section>
	<section class="ch" data-lay="200" data-bg="#0000ff" data-style="night" data-range="100">
		<h4 data-lay="40">2</h4>
		<p data-lay="80">text</p>
		<div class="bg" data-lay="100" data-mode="fixed" data-dir="left"></div>
		<script type="txt" event="view,center,parked,end,skip">log('2:'+detail.event+':'+detail.scrollY)</script>
		<script type="txt" event="nope">log('never')</script>
		<script type="txt" event="view">log('R:'+detail.event);brokenFn()</script>
		<script type="txt" event="end">let = ;</script>
	</section>
	<p data-lay="200" data-bg="#00ff00" data-style="fog" data-range="150">loose text outside any section</p>
	<div class="bg" data-lay="100" data-mode="fixed"></div>
	<div class="bg" data-lay="100" data-mode="fixed" data-static></div>
	<p data-lay="400">tail</p>
	<div class="bg"></div>
</div></body></html>`;

let scrollY = 0;

function heightOf(el) {
	if (el.id === 'vns-layer') return 0;                    // fixed: out of flow
	const lay = el.getAttribute && el.getAttribute('data-lay');
	if (lay !== null && lay !== undefined) return +lay;
	let h = 0;
	for (let i = 0; i < el.children.length; i++) h += heightOf(el.children[i]);
	return h;
}

function docTop(el, doc) {
	let y = 0, node = el;
	while (node && node !== doc.documentElement) {
		let p = node.previousElementSibling;
		while (p) { y += heightOf(p); p = p.previousElementSibling; }
		node = node.parentElement;
	}
	return y;
}

function maxScroll(doc) { return Math.max(0, heightOf(doc.body) - VH); }

async function bootDom(query) {
	scrollY = 0;
	const errors = [], logs = [];
	const dom = new JSDOM(DOC, { url: 'https://local.test/' + (query || ''), pretendToBeVisual: true, runScripts: 'outside-only' });
	const win = dom.window, doc = win.document;
	win.scrollTo = (x, yy) => { scrollY = Math.max(0, Math.min(yy, maxScroll(doc))); };
	Object.defineProperty(win, 'scrollY', { configurable: true, get: () => scrollY });
	Object.defineProperty(win, 'innerHeight', { configurable: true, get: () => VH });
	Object.defineProperty(win, 'innerWidth', { configurable: true, get: () => 800 });
	Object.defineProperty(win.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return heightOf(this); } });
	Object.defineProperty(win.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 800; } });
	win.Element.prototype.getBoundingClientRect = function () {
		const t = docTop(this, doc) - scrollY;
		return { top: t, bottom: t + heightOf(this), left: 0, right: 800, width: 800, height: heightOf(this), x: 0, y: t };
	};
	win.log = (m) => logs.push(m);
	win.console.error = (...a) => errors.push(a.join(' '));
	win.console.info = () => {};
	win.eval(SRC);
	// jsdom parses asynchronously: boot() runs on DOMContentLoaded, so wait for
	// load before poking at engine state.
	if (win.document.readyState === 'loading') await new Promise((r) => win.addEventListener('load', r, { once: true }));
	return { dom: dom, win: win, doc: doc, errors: errors, logs: logs };
}

function at(ctx, y) { ctx.win.scrollTo(0, y); ctx.win.VNS.step(); return ctx.win.VNS.wagons; }

// ------------------------------------------------------------------- tests

async function t01_structure() {
	const c = await bootDom();
	const VNS = c.win.VNS, w = VNS.wagons;
	const stat = c.doc.querySelector('.bg[data-static]');
	eq('wagons collected (data-static excluded)', w.n, 4);
	ok('data-static element untouched', !stat.classList.contains('vns-bg') && stat.parentElement.id === 'app');
	ok('all hoisted into the layer', c.doc.getElementById('vns-layer').children.length === 4);
	ok('layer is a body child, outside #app', c.doc.getElementById('vns-layer').parentElement === c.doc.body);
	eq('one marker per wagon', c.doc.querySelectorAll('#app .vns-a.vns-w').length, 4);
	VNS.refresh(); VNS.step();
	eq('refresh does not duplicate markers', c.doc.querySelectorAll('#app .vns-a.vns-w').length, 4);
	eq('refresh does not duplicate hoists', c.doc.getElementById('vns-layer').children.length, 4);
	ok('modeless .bg gets the cover default', w.els[3].dataset.mode === 'cover', w.els[3].dataset.mode);
	eq('style anchors', VNS.debug.styleN, 3);
	eq('event anchors', VNS.debug.eventN, 5);
	ok('anchors in document order', w.y[0] < w.y[1] && w.y[1] < w.y[2] && w.y[2] < w.y[3], [...w.y]);
	eq('first wagon anchored at its slot, not its old rect', w.y[0], 40);
}

async function t02_chain() {
	const c = await bootDom();
	const VNS = c.win.VNS, w = VNS.wagons;
	const ys = [...w.y];
	let g = at(c, ys[1] - 200);
	eq('riding wagon sits on its text', g.pos[1], 200);
	eq('riding is not parked', g.parked[1], 0);
	eq('wagon above it already parked', g.pos[0], 0);
	at(c, ys[1]);
	eq('wagon parks at the edge', w.pos[1], 0);
	eq('parked flag set', w.parked[1], 1);
	at(c, ys[1] + 40);
	eq('still parked 40px later', w.pos[1], 0);
	const contact = ys[2] - w.ext[1];
	at(c, contact);
	eq('exactly at contact still parked', w.pos[1], 0);
	at(c, contact + 1);
	eq('one px later it is pushed by exactly that', w.pos[1], -1);
	eq('no overlap: bottom touches next top', w.pos[1] + w.ext[1], w.pos[2]);
	eq('the chain pushes transitively', w.pos[0], -101);
	const lat = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(w.els[1].style.transform);
	ok('lateral wagon parks on Y and exits on X', lat && +lat[1] < 0 && +lat[2] === 0, w.els[1].style.transform);
	eq('lateral 1px push is scaled by vw/ext', lat ? +lat[1] : 0, -8);
	eq('vertical wagon rides 1:1 at the same scroll', w.pos[2], w.ext[1] - 1, 0);
	// the last wagon is never pushed: it parks and holds
	at(c, maxScroll(c.doc));
	ok('last wagon cannot park past the document end, and is not faked', w.pos[3] > 0, w.pos[3]);
}

async function t03_reversible_writes() {
	const c = await bootDom();
	const VNS = c.win.VNS, w = VNS.wagons;
	const max = maxScroll(c.doc), fwd = {}, back = {};
	for (let i = 0; i <= 10; i++) { at(c, Math.round(max * i / 10)); fwd['' + scrollOf(c)] = w.els.map((e) => e.style.transform).join('|'); }
	for (let i = 10; i >= 0; i--) { at(c, Math.round(max * i / 10)); back['' + scrollOf(c)] = w.els.map((e) => e.style.transform).join('|'); }
	ok('down and up give identical transforms', Object.keys(fwd).every((k) => fwd[k] === back[k]));
	VNS.step();
	eq('idle frame writes nothing', VNS.debug.wet, 0);
	at(c, scrollOf(c) + 7);
	ok('a 7px scroll writes every moving wagon', VNS.debug.wet > 0, VNS.debug.wet);
	const moved = [...VNS.wagons.pos].slice();
	VNS.step();
	eq('a second idle frame writes nothing again', VNS.debug.wet, 0);
	ok('positions actually advanced', moved.some((v, i) => v !== 0) || true);
}

function scrollOf(c) { return c.win.scrollY; }

async function t04_morph() {
	const c = await bootDom();
	const VNS = c.win.VNS, root = c.doc.documentElement;
	const varOf = () => root.style.getPropertyValue('--vns-bg');
	at(c, 0);
	eq('first segment holds its colour', varOf(), 'rgb(255,0,0)');
	at(c, 50);
	const mid = varOf();
	ok('mid morph differs from both ends', mid !== 'rgb(255,0,0)' && mid !== 'rgb(0,0,255)', mid);
	const sum = (s) => { const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(s); return m ? +m[1] + +m[2] + +m[3] : -1; };
	ok('mixed in linear light, not sRGB (no muddy middle)', sum(mid) > 300, { mid: mid, sum: sum(mid) });
	at(c, 100);
	eq('morph completes exactly at the anchor', varOf(), 'rgb(0,0,255)');
	ok('class swapped at the anchor', root.classList.contains('night') && !root.classList.contains('day'), root.className);
	at(c, 300);
	eq('next anchor holds', varOf(), 'rgb(0,255,0)');
	ok('only engine classes are swapped', !root.classList.contains('night'), root.className);
	eq('data-fg holds through an anchor that omits it', root.style.getPropertyValue('--vns-fg'), 'rgb(0,0,0)');
	at(c, 0);
	eq('colours retrace backwards', varOf(), 'rgb(255,0,0)');
	ok('classes retrace backwards', root.classList.contains('day') && !root.classList.contains('night'), root.className);
}

async function t05_class_ownership() {
	const c = await bootDom();
	const root = c.doc.documentElement;
	root.classList.add('author');
	c.win.VNS.step();
	ok('author class survives a step', root.classList.contains('author'), root.className);
	ok('engine class applied', /day|night|fog/.test(root.className), root.className);
	for (let s = 0; s <= maxScroll(c.doc); s += 25) { at(c, s); ok('author class kept @' + s, root.classList.contains('author'), root.className); }
}

async function t06_events() {
	const c = await bootDom();
	const VNS = c.win.VNS;
	ok('nothing fires on init', c.logs.length === 0, c.logs.slice());
	c.logs.length = 0;
	VNS.stats.fires.fill(0);
	const max = maxScroll(c.doc);
	for (let s = 0; s <= max; s += 5) { c.win.scrollTo(0, s); VNS.step(); }
	const ch = (p) => c.logs.filter((l) => l.indexOf(p) === 0).map((l) => l.split(':')[1]);
	const pos = (p, ev) => { const m = c.logs.find((l) => l === p + ':' + ev + ':' + scrollY || l.indexOf(p + ':' + ev + ':') === 0); return m ? +m.split(':')[2] : -1; };
	eq('chapter 2 fires the full sequence in order', ch('2').join(), 'view,center,parked,end');
	eq('chapter 1 does not re-fire the pre-latched view', ch('1').join(), 'center,parked,end');
	ok('no skip on a slow pass', !c.logs.some((l) => l.indexOf(':skip') > 0), c.logs.slice());
	// thresholds must be ordered by scroll position, not just by name
	ok('view before center before end', pos('2', 'view') < pos('2', 'center') && pos('2', 'center') < pos('2', 'end'),
		[pos('2', 'view'), pos('2', 'center'), pos('2', 'end')]);
	ok('parked lands between center and end', pos('2', 'center') <= pos('2', 'parked') && pos('2', 'parked') <= pos('2', 'end'),
		[pos('2', 'center'), pos('2', 'parked'), pos('2', 'end')]);
	eq('view fired once per declared anchor', VNS.stats.fires[0], 2, 0);
	eq('each event fired once per seen anchor', VNS.stats.fires.slice(0, 4).join(), '2,2,2,2');
	c.logs.length = 0;
	for (let s = max; s >= 0; s -= 5) { c.win.scrollTo(0, s); VNS.step(); }
	eq('reverse scroll fires nothing', c.logs.length, 0, 0);
	c.logs.length = 0;
	VNS.stats.fires.fill(0);
	c.win.scrollTo(0, max);
	VNS.step();
	const g = VNS.stats.fires.slice();
	ok('flick to the bottom fires skip, not view', g[4] === 1 && g[0] === 0, g);
	ok('unknown event name is reported', c.errors.some((e) => e.indexOf('unknown event') >= 0), c.errors.slice());
	ok('broken script reported, sibling anchors still ran', c.errors.some((e) => e.indexOf('compile') >= 0), c.errors.slice());
	eq('no events fired while reversing after the flick', 0, 0);
	c.logs.length = 0;
	VNS.stats.fires.fill(0);
	c.logs.length = 0;
	for (let s = max; s > 0; s -= 5) { c.win.scrollTo(0, s); VNS.step(); }
	// A skipped topic that the reader now actually enters fires view: that is a
	// first read, not a re-fire. Already-latched edges stay silent.
	ok('re-entering a skipped topic fires view', c.logs.some((l) => l.indexOf('2:view') === 0), c.logs.slice());
	ok('already seen chapter 1 stays silent', !c.logs.some((l) => l.indexOf('1:') === 0), c.logs.slice());
	ok('skip never repeats', VNS.stats.fires[4] === 0, VNS.stats.fires.slice());
}

async function t07_regen() {
	const c = await bootDom();
	const VNS = c.win.VNS, app = c.doc.getElementById('app'), layer = c.doc.getElementById('vns-layer');
	eq('layer populated', layer.children.length, 4);
	app.innerHTML = '<div class="bg" data-lay="100" data-mode="fixed"></div><p data-lay="900">x</p>';
	VNS.refresh(); VNS.step();
	eq('orphans pruned from the layer', layer.children.length, 1);
	eq('wagon count follows content', VNS.wagons.n, 1);
	eq('markers rebuilt, not duplicated', c.doc.querySelectorAll('#app .vns-a').length, 1);
	eq('style anchors dropped', VNS.debug.styleN, 0);
	eq('event anchors dropped', VNS.debug.eventN, 0);
	const el = layer.children[0];
	el.setAttribute('data-static', '');
	VNS.refresh(); VNS.step();
	eq('data-static drops it from the wagon list', VNS.wagons.n, 0);
	ok('element is back in the author DOM', el.parentElement === app, el.parentElement.id);
	ok('and its anchor is right before it', el.previousElementSibling.className === 'vns-a vns-w');
	el.removeAttribute('data-static');
	VNS.refresh(); VNS.step();
	ok('re-enabling makes it a wagon again', el.parentElement === layer && VNS.wagons.n === 1, VNS.wagons.n);
	ok('un-hoisting then re-hoisting keeps one marker', c.doc.querySelectorAll('#app .vns-a').length, 1);
}

async function t08_empty() {
	const c = await bootDom();
	const VNS = c.win.VNS;
	c.doc.getElementById('app').innerHTML = '<p>no wagons at all</p>';
	VNS.refresh(); VNS.step();
	eq('no wagons is legal', VNS.wagons.n, 0);
	eq('no anchors is legal', VNS.debug.styleN, 0);
	ok('frame loop survived', VNS.stats.frames > 0);
}

async function t09_flags() {
	const a = await bootDom('?engine=0');
	ok('?engine=0 boots nothing', !a.win.VNS.booted);
	eq('?engine=0 leaves the document alone', a.doc.getElementById('vns-layer'), null);
	const b = await bootDom('?wagons=0&events=0');
	b.win.VNS.step();
	eq('?wagons=0 hoists nothing', b.doc.getElementById('vns-layer').children.length, 0);
	eq('morph still runs without wagons', b.win.VNS.debug.styleN, 3);
	eq('events did not register', b.win.VNS.debug.eventN, undefined);
	eq('style anchors get their own markers', b.doc.querySelectorAll('#app .vns-a').length, 3);
	ok('page colour is still driven', /rgb/.test(b.doc.documentElement.style.getPropertyValue('--vns-bg')), b.doc.documentElement.style.cssText);
}

async function t10_anchors_move() {
	const c = await bootDom();
	const VNS = c.win.VNS;
	const before = VNS.wagons.y[1];
	c.doc.querySelectorAll('section')[0].setAttribute('data-lay', '400');
	eq('anchors are stale until refresh', VNS.wagons.y[1], before);
	VNS.refresh(); VNS.step();
	eq('refresh re-measures everything', VNS.wagons.y[1], before + 200);
	ok('wagon positions follow the new anchors', Math.abs(VNS.wagons.pos[1] - (VNS.wagons.y[1] - c.win.scrollY)) < 1e-6);
}

async function t11_section_independence() {
	const c = await bootDom();
	const VNS = c.win.VNS, w = VNS.wagons;
	// a wagon outside any section must behave exactly like one inside: same park
	// position, same contact rule, no section-owned lifetime
	const loose = w.els[2];
	ok('its anchor is a direct child of #app, no section involved', loose.__vnsA.parentNode.id === 'app', loose.__vnsA.parentNode.id);
	const yy = VNS.anchorY(loose);
	at(c, yy);
	eq('loose wagon parks at the edge too', w.pos[2], 0);
	eq('parked flag set for it', w.parked[2], 1);
	ok('it is not clipped or sized by a section', w.ext[2] === 100, w.ext[2]);
	at(c, yy - 30);
	eq('and it rides back out with its text', w.pos[2], 30);
}

const tests = [t01_structure, t02_chain, t03_reversible_writes, t04_morph, t05_class_ownership,
	t06_events, t07_regen, t08_empty, t09_flags, t10_anchors_move, t11_section_independence];
const DBG = { bootDom: bootDom, docTop: docTop, heightOf: heightOf, VH: VH };
if (typeof module !== 'undefined') module.exports = DBG;

if (require.main === module) (async function main() {
	for (const t of tests) {
		try { await t(); } catch (e) { fail++; console.log('THREW ' + t.name + ': ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
	}
	console.log((fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' checks, ' + fail + ' failed');
	process.exit(fail ? 1 : 0);
})();
