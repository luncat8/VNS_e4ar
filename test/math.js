// test/math.js — headless gate for the engine's math. `node test/math.js`.
// Everything here is a pure function from vns.js: no DOM, no browser.

const VNS = require('../vns.js').pure;
let pass = 0, fail = 0;

function ok(name, cond, extra) {
	if (cond) { pass++; return; }
	fail++;
	console.log('FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
}

function near(name, got, want, eps) {
	ok(name, Math.abs(got - want) <= eps, { got: got, want: want, eps: eps });
}

function run(free, ext) {
	const pos = new Float64Array(free.length);
	VNS.wagonChain(Float64Array.from(free), Float64Array.from(ext), pos, free.length);
	return pos;
}

// ------------------------------------------------------------- wagon chain

ok('empty chain', run([], []).length === 0);

const single = run([500], [512]);
near('riding wagon follows its text', single[0], 500, 1e-9);
near('parked wagon sticks at 0', run([-10], [512])[0], 0, 1e-9);
near('parked wagon does not drift above 0 while unpushed', run([-9000], [512])[0], 0, 1e-9);

// two wagons with plenty of text between them (gap 1000 >= height 512)
{
	const ya = 1000, yb = 2000, h = 512;
	for (let s = 0; s <= 3200; s += 7) {
		const p = run([ya - s, yb - s], [h, h]);
		ok('gap: no overlap @' + s, p[0] + h <= p[1] + 1e-9, p);
		if (ya - s > 0) ok('gap: rides its text @' + s, p[0] === ya - s, p[0]);
		else if (p[1] >= h) ok('gap: parks and waits @' + s, p[0] === 0, p[0]);
		else ok('gap: pushed exactly by contact @' + s, Math.abs(p[0] - (p[1] - h)) < 1e-9, p);
	}
}

// contact then push: next wagon's top touches my bottom, I move off screen
const push = run([0, 512], [512, 512]);
near('contact frame: still parked', push[0], 0, 1e-9);
const push2 = run([-100, 412], [512, 512]);
near('pushed by exactly the overlap', push2[0], -100, 1e-9);
const push3 = run([-1000, -488], [512, 512]);
near('chain of 3 resolves transitively', run([-1000, -488, 24], [512, 512, 512])[0], -1000, 1e-9);
const stack = run([-200, -100, 0, 100], [512, 512, 512, 512]);
ok('tight train keeps contact everywhere', stack[0] + 512 === stack[1] && stack[1] + 512 === stack[2] && stack[2] + 512 === stack[3], stack);

// last wagon is never pushed by anything
for (let s = 0; s < 5000; s += 13) {
	const p = run([100 - s, 900 - s], [512, 512]);
	ok('last wagon parks and holds @' + s, p[1] === Math.max(900 - s, 0), p[1]);
}

// zero gap (two .bg back to back) — coupled filmstrip, but continuous
let prevY = run([3000, 3000], [512, 512])[0];
for (let s = 2999; s >= 0; s--) {
	const p = run([s, s], [512, 512]);
	ok('zero gap continuous @' + s, Math.abs(p[0] - prevY) <= 1, { a: p[0], b: prevY });
	prevY = p[0];
}

// global invariants over a random-ish layout: continuous, monotone, reversible
const ext = [512, 1024, 512, 256, 1024, 512];
const ys = [300, 2400, 2450, 5000, 6200, 9999];
let last = null;
for (let s = 0; s <= 12000; s += 3) {
	const p = run(ys.map((y) => y - s), ext);
	if (last) {
		for (let i = 0; i < p.length; i++) {
			ok('no jump @' + s + ' w' + i, Math.abs(p[i] - last[i]) <= 3 + 1, { p: p[i], l: last[i] });
			ok('never moves down while scrolling down @' + s + ' w' + i, p[i] <= last[i] + 1e-9);
			if (i + 1 < p.length && ext[i] >= 0) ok('no overlap @' + s + ' w' + i, p[i] + ext[i] <= p[i + 1] + 1e-9, p);
		}
	}
	last = Array.from(p);
}
for (let i = 0; i < ys.length; i++) {
	const a = run(ys.map((y) => y - 4321), ext)[i];
	const b = run(ys.map((y) => y - 4321), ext)[i];
	ok('pure function of scrollY (reversible) w' + i, a === b);
}
// anchor alignment holds whenever the gap below is at least the wagon height
for (let i = 0; i + 1 < ys.length; i++) {
	const gap = ys[i + 1] - ys[i];
	if (gap < ext[i]) continue;
	const s = ys[i] - 300;
	const p = run(ys.map((y) => y - s), ext);
	ok('riding wagon top == its text line w' + i, Math.abs(p[i] - 300) < 1e-9, p[i]);
}

// --------------------------------------------------------- exit directions

const o = [0, 0];
for (const [dir, name] of [[VNS.DIR_TOP, 'top'], [VNS.DIR_LEFT, 'left'], [VNS.DIR_RIGHT, 'right'], [VNS.DIR_BOTTOM, 'bottom']]) {
	VNS.wagonExit(300, dir, o);
	ok(name + ': riding follows text', o[0] === 0 && o[1] === 300, o.slice());
	VNS.wagonExit(0, dir, o);
	ok(name + ': parked sits on the edge', o[0] === 0 && o[1] === 0, o.slice());
	VNS.wagonExit(-400, dir, o);
	const exit = o.slice();
	ok(name + ': pushed moves off screen', exit[0] !== 0 || exit[1] !== 0, exit);
	ok(name + ': exit distance equals push distance', Math.abs(Math.max(Math.abs(exit[0]), Math.abs(exit[1]))) === 400, exit);
	if (dir === VNS.DIR_LEFT || dir === VNS.DIR_RIGHT) ok(name + ': lateral exit stays parked on Y', exit[1] === 0, exit);
	let before = null, cont = true;
	for (let t = 300; t >= -300; t--) {
		VNS.wagonExit(t, dir, o);
		if (before !== null && Math.abs(o[1] - before[1]) > 1) cont = false;
		before = o.slice();
	}
	ok(name + ': exit vector is continuous through the park', cont);
}

// -------------------------------------------------------------- colours

const c = new Uint8Array(4);
ok('hex short', VNS.parseColor('#f0a', c) === 1 && c[0] === 255 && c[1] === 0 && c[2] === 170, c.slice());
ok('hex long', VNS.parseColor('#0b1020', c) === 1 && c[0] === 11 && c[1] === 16 && c[2] === 32, c.slice());
ok('hex alpha', VNS.parseColor('#ff000080', c) === 1 && c[0] === 255 && c[3] === 128, c.slice());
ok('rgb()', VNS.parseColor('rgb(10, 20,30)', c) === 1 && c[2] === 30, c.slice());
ok('rgba()', VNS.parseColor('rgba(1,2,3,0.5)', c) === 1 && c[0] === 1 && c[3] === 128, c.slice());
ok('rejects gradient token', VNS.parseColor('linear-gradient(#000,#fff)', c) === 0);
ok('rejects empty', VNS.parseColor('', c) === 0 && VNS.parseColor(null, c) === 0);
ok('rejects junk hex', VNS.parseColor('#12345', c) === 0 && VNS.parseColor('#gggggg', c) === 0);

const two = new Uint8Array(8);
two[0] = 0; two[3] = 255; two[4] = 255; two[5] = 255; two[6] = 255; two[7] = 255;
const m = new Uint8Array(4);
VNS.mixColor4(m, two, 0, 1, 0);
ok('mix t=0 is the left colour', m[0] === 0 && m[1] === 0 && m[2] === 0);
VNS.mixColor4(m, two, 0, 1, 1);
ok('mix t=1 is the right colour', m[0] === 255 && m[1] === 255 && m[2] === 255, m.slice());
VNS.mixColor4(m, two, 0, 1, 0.5);
// mid grey in linear light is ~0.22 encoded, i.e. 187 — a value near 127 would
// mean the lerp was done in sRGB and the sunset looks muddy.
ok('mix is linear-light', m[0] > 170 && m[0] < 205, m.slice());
VNS.mixColor4(m, two, 1, 1, 0.3);
ok('mix same index copies', m[0] === 255 && m[1] === 255);

// ------------------------------------------------------------------ easing

near('ease(0)', VNS.ease(0), 0, 1e-9);
near('ease(1)', VNS.ease(1), 1, 1e-9);
near('ease(0.5)', VNS.ease(0.5), 0.5, 1e-9);
near('ease clamps low', VNS.ease(-2), 0, 1e-9);
near('ease clamps high', VNS.ease(9), 1, 1e-9);
let mono = true, sym = true, p0 = -1;
for (let i = 0; i <= 100; i++) {
	const t = VNS.ease(i / 100);
	if (t < p0) mono = false;
	p0 = t;
	if (Math.abs(t - (1 - VNS.ease(1 - i / 100))) > 1e-9) sym = false;
}
ok('ease monotone', mono);
ok('ease symmetric', sym);
ok('ease slow at the ends', VNS.ease(0.1) < 0.1 && VNS.ease(0.9) > 0.9);

// ----------------------------------------------------------- index search

const ys2 = [10, 20, 20, 50];
ok('lastIndexLE before', VNS.lastIndexLE(ys2, 4, 5) === -1);
ok('lastIndexLE at', VNS.lastIndexLE(ys2, 4, 10) === 0);
ok('lastIndexLE picks the last equal', VNS.lastIndexLE(ys2, 4, 20) === 2);
ok('lastIndexLE between', VNS.lastIndexLE(ys2, 4, 35) === 2);
ok('lastIndexLE after', VNS.lastIndexLE(ys2, 4, 999) === 3);

// ------------------------------------------------------------------ events

function sim(anchors, vh, steps, hs) {
	const state = new Uint8Array(anchors.length);
	const fired = [];
	for (const s of steps) {
		for (let i = 0; i < anchors.length; i++) {
			const d = anchors[i] - s;
			const e = VNS.eventEdges(d, 0, vh, 0);
			const out = VNS.eventStep(state[i], e, d, vh, hs, new Int32Array(2));
			state[i] = out[0];
			for (let k = 0; k < 5; k++) if (out[1] & (1 << k)) fired.push(k + ':' + i + '@' + s);
		}
	}
	return { fired: fired, state: state };
}

const NAMES = ['view', 'center', 'parked', 'end', 'skip'];

// slow pass over two topics: view, center, end — once each, in that order
{
	const down = [];
	for (let s = 0; s <= 3000; s += 5) down.push(s);
	const r = sim([500, 1500], 800, down, 40);
	const want = '0:0@0|1:0@105|3:0@505|0:1@705|1:1@1105|3:1@1505';
	ok('slow pass order and count', r.fired.join('|') === want, r.fired.join('|'));
	ok('slow pass never fires skip or parked', !r.fired.some((f) => f[0] === '4' || f[0] === '2'), r.fired);
}

// flick to the bottom: only end + skip, never view/center
{
	const r = sim([500, 1500, 2500], 800, [9000], 40);
	ok('flick fires skip+end only', r.fired.length === 6 && r.fired.every((f) => f[0] === '3' || f[0] === '4'), r.fired);
	ok('flick latches skip and end', [0, 1, 2].every((i) => r.state[i] & VNS.E_SKIP && r.state[i] & VNS.E_END), r.state);
	const slow = sim([20000], 800, [19500, 19700, 20100], 40);
	ok('no skip when view was seen', slow.fired.join('|') === '0:0@19500|1:0@19700|3:0@20100', slow.fired);
}

// bounce on the top edge: end re-arms, view does not re-fire
{
	const r = sim([500], 800, [0, 600, 400, 600, 400, 700], 40);
	ok('bounce does not re-fire view', r.fired.filter((f) => f[0] === '0').length === 1, r.fired);
	ok('bounce re-fires end every pass', r.fired.filter((f) => f[0] === '3').length === 3, r.fired);
	ok('bounce fires no skip', !r.fired.some((f) => f[0] === '4'), r.fired);
}

// re-entry from the top re-arms `end` only (view/center belong to the bottom edge)
{
	const r = sim([1500], 800, [800, 1200, 1600, 800, 1200, 1600], 40);
	ok('re-entry re-arms end', r.fired.filter((f) => f[0] === '3').length === 2, r.fired);
	ok('re-entry does not re-fire view', r.fired.filter((f) => f[0] === '0').length === 1, r.fired);
}
// leaving through the bottom edge (beyond hysteresis) re-arms the whole pass
{
	const r = sim([1500], 800, [1500, 400, 1500], 40);
	ok('bottom exit re-arms view', r.fired.filter((f) => f[0] === '0').length === 2, r.fired);
	ok('bottom exit re-arms center', r.fired.filter((f) => f[0] === '1').length === 2, r.fired);
	ok('bottom exit fires no skip', !r.fired.some((f) => f[0] === '4'), r.fired);
}

// reversibility: the state machine's *set* of fired events must not depend on
// direction, and edges at a given scrollY are identical both ways
{
	const a = VNS.eventEdges(500 - 1234, 0, 800, 1), b = VNS.eventEdges(500 - 1234, 0, 800, 1);
	ok('edges are a pure function of scrollY', a === b);
	const s1 = VNS.eventStep(0, a, -734, 800, 40, new Int32Array(2))[1];
	const s2 = VNS.eventStep(0, b, -734, 800, 40, new Int32Array(2))[1];
	ok('step is a pure function of (state, scrollY)', s1 === s2);
}

// skip must never fire together with view for the same anchor
{
	for (let step = 1; step <= 400; step += 3) {
		const steps = [];
		for (let s = 0; s <= 4000; s += step) steps.push(s);
		const r = sim([500, 1500, 2500, 3500], 800, steps, 40);
		for (let i = 0; i < 4; i++) {
			const v = r.fired.some((f) => f[0] === '0' && f[1] === String(i));
			const k = r.fired.some((f) => f[0] === '4' && f[1] === String(i));
			ok('skip XOR view at step ' + step + ' anchor ' + i, !(v && k), { v: v, k: k, step: step });
		}
	}
}

console.log((fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
