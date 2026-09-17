// test/page.js — integration smoke test: loads the real index.html with
// harness.css, vns.js and harness.js through jsdom, exactly as a browser would,
// and checks the wiring. jsdom has no layout, so every box is 0×0: geometry
// checks live in test/dom.js; this file proves the page assembles, that every
// control the harness touches exists, that the engine finds the generated
// wagons, and that the QA probes run without throwing.
//
// `node test/page.js`

const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
	if (cond) { pass++; return; }
	fail++;
	console.log('FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
}
function eq(name, got, want, extra) { ok(name, got === want, { got: got, want: want, extra: extra }); }

function load(query) {
	const errs = [];
	const vc = new (require('jsdom').VirtualConsole)();
	vc.on('jsdomError', (e) => errs.push('jsdomError: ' + e.message));
	vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));
	vc.on('warn', () => {});
	vc.on('log', () => {});
	vc.on('info', () => {});
	const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
		url: 'file://' + ROOT + '/index.html' + (query || ''),
		runScripts: 'dangerously',
		resources: 'usable',
		pretendToBeVisual: true,
		virtualConsole: vc
	});
	return { dom: dom, win: dom.window, errs: errs };
}

const CONTROLS = ['gen', 'app', 'diag', 'dstats', 'qa', 'rail', 'mark', 'wires', 'last', 'menu',
	'preset', 'n', 'nO', 'len', 'gap', 'mode', 'size', 'dir', 'nest', 'style', 'events', 'stat', 'wire', 'bad',
	'eng', 'jump', 'speed', 'spd', 'reg', 'seed', 'top', 'bot', 'next', 'prev', 'auto', 'qaBtn'];

async function ready(win) {
	if (win.document.readyState === 'complete') { await new Promise((r) => setTimeout(r, 120)); return; }
	await new Promise((r) => win.addEventListener('load', r, { once: true }));
	await new Promise((r) => setTimeout(r, 120));
}

async function main() {
	const { dom, win, errs } = load('#preset=mono&n=4&style=1&events=1&stat=1');
	await ready(win);
	const doc = win.document;

	eq('no script errors on a normal load', errs.length, 0, errs.join('\n'));
	ok('every control the harness references exists', CONTROLS.every((id) => !!doc.getElementById(id)),
		CONTROLS.filter((id) => !doc.getElementById(id)));

	const app = doc.getElementById('app');
	ok('story was generated', app.innerHTML.length > 5000, app.innerHTML.length);
	ok('chapters carry labels', app.querySelectorAll('h4.n[data-k]').length === 4, app.querySelectorAll('h4.n[data-k]').length);
	ok('wagons were emitted', app.querySelectorAll('.bg').length + doc.getElementById('vns-layer').children.length > 0);
	ok('engine hoisted them into the layer', doc.getElementById('vns-layer').children.length > 0);
	ok('markers were inserted', doc.querySelectorAll('#app .vns-a').length > 0);
	ok('no external urls in the story', !/url\((['"]?)(?!data:)[a-z]+:\/\//i.test(app.innerHTML) && !/(src|href)=["'](?!#)/i.test(app.innerHTML));
	ok('event scripts stayed inert and in the DOM', app.querySelectorAll('script[type="txt"]').length > 0);
	ok('injected engine css is present', !!doc.getElementById('vns-css'));
	ok('engine booted', !!(win.VNS && win.VNS.booted));
	ok('wagon list matches the document', win.VNS.wagons.n > 0, win.VNS.wagons.n);
	ok('style anchors found', win.VNS.debug.styleN >= 4, win.VNS.debug.styleN);
	ok('event anchors found', win.VNS.debug.eventN >= 4, win.VNS.debug.eventN);
	ok('VNSlog is callable from generated scripts', typeof win.VNSlog === 'function');
	ok('regen is fast enough for 12 chapters', (() => {
		const t = [];
		for (let i = 0; i < 3; i++) {
			const a = performance.now();
			win.eval('cfg.n=12;applyForm();build()');
			t.push(performance.now() - a);
		}
		return Math.max(...t) < 400;             // jsdom is slow; browsers are far under 100ms
	})());
	ok('diagnostics panel has content', doc.getElementById('dstats').textContent.length > 40);
	eq('rail marker initialised', doc.getElementById('mark').textContent === '0', true);

	// QA probes must run to completion on any DOM, and report per row. A second
	// launch while the first awaits must not reset the shared probe state.
	const before = errs.length;
	const firstQA = win.eval('qaAll()');
	eq('QA button locks while a run is pending', doc.getElementById('qaBtn').disabled, true);
	win.eval('qaAll()');
	eq('duplicate QA launch leaves the run locked', doc.getElementById('qaBtn').disabled, true);
	await firstQA;
	ok('QA probes ran without throwing', errs.filter((e, i) => i >= before && /Cannot read|is not a function|undefined/.test(e)).length === 0,
		errs.slice(before).join('\n').slice(0, 300));
	eq('QA button unlocks after a run', doc.getElementById('qaBtn').disabled, false);
	eq('QA button label is restored', doc.getElementById('qaBtn').textContent, 'QA all (q)');
	ok('QA produced rows', doc.getElementById('qa').children.length >= 4, doc.getElementById('qa').children.length);
	const beforeSecond = errs.length;
	await win.eval('qaAll()');
	ok('second QA run completes cleanly', errs.filter((e, i) => i >= beforeSecond && /Cannot read|is not a function|undefined/.test(e)).length === 0,
		errs.slice(beforeSecond).join('\n').slice(0, 300));

	// hash config round trip
	win.eval('cfg.preset="tight";cfg.n=9;syncForm();writeHash();regen(true)');
	ok('hash holds the config', /preset=tight/.test(win.location.hash) && /n=9/.test(win.location.hash), win.location.hash);
	ok('deterministic: same hash, same bytes', (() => {
		const a = doc.getElementById('app').innerHTML;
		win.eval('build()');
		return doc.getElementById('app').innerHTML === a;
	})());
	win.close();

	const off = load('?engine=0&n=4#preset=mixed');
	await ready(off.win);
	const odoc = off.win.document;
	ok('?engine=0 path still renders the story', odoc.getElementById('app').innerHTML.length > 5000);
	ok('?engine=0 creates no layer and no markers', !odoc.getElementById('vns-layer') && !odoc.querySelector('.vns-a'));
	ok('?engine=0 leaves no script errors', off.errs.length === 0, off.errs.join('\n').slice(0, 300));
	off.win.close();

	const nw = load('?wagons=0');
	await ready(nw.win);
	ok('?wagons=0 leaves .bg in the author DOM', nw.win.VNS.wagons.n === 0, nw.win.VNS.wagons.n);
	ok('?wagons=0 keeps morph running', nw.win.VNS.debug.styleN > 0, nw.win.VNS.debug.styleN);
	nw.win.close();

	console.log((fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' checks, ' + fail + ' failed');
	process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.log('THREW', e.stack); process.exit(1); });
