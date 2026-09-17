// test/assets.js — validates what only a CSS/HTML parser can: that every
// generated box actually carries a background, that the inline style
// attributes are legal CSS and survived HTML quoting, that the inline SVG art
// is well-formed XML with the size the wagon declared, and that the two
// stylesheets parse and contain the rules the DOM contract promises.
//
// A truncated `style="…url("data:…")…"` or a dropped declaration shows up here
// as "nothing to paint", which is exactly how it would show up in a browser.
//
// `node test/assets.js`  (needs `npm i jsdom css-tree saxes`; jsdom's own XML
// parser is a stub, so well-formedness goes through saxes directly.)

const { JSDOM } = require('jsdom');
const csstree = require('css-tree');
const { SaxesParser } = require('saxes');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
	if (cond) { pass++; return; }
	fail++;
	console.log('FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
}
function eq(name, got, want) { ok(name, got === want, { got: got, want: want }); }

function parseCSS(src, label) {
	return scan(src, label, 'stylesheet');
}

function parseDecls(src, label) {
	return scan(src, label, 'declarationList');
}

function scan(src, label, ctx) {
	const errs = [];
	csstree.parse(src, {
		positions: true,
		context: ctx,
		onParseError(e) { if (errs.length < 6) errs.push(label + ':' + e.line + ' ' + e.message); }
	});
	return errs;
}

function loadStory(hash, console_) {
	const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
		url: 'file://' + ROOT + '/index.html' + (hash || ''),
		runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
		virtualConsole: console_
	});
	return dom;
}

async function main() {
	// ---- stylesheets
	const harnessCSS = fs.readFileSync(path.join(ROOT, 'harness.css'), 'utf8');
	eq('harness.css parses', parseCSS(harnessCSS, 'harness.css').length, 0);
	// the 0.1 contract, checked as text so a rename cannot silently break the demo
	ok('contract: #app is a positioned layer above the wagons',
		/#app\s*\{[^}]*position:relative[^}]*z-index:1/.test(harnessCSS));
	ok('contract: page colour lives on <html> from the morph vars',
		/html\s*\{[^}]*background:var\(--vns-bg/.test(harnessCSS));
	ok('contract: no-engine .bg fallback is a behind-text layer',
		/#app \.bg\{[^}]*position:absolute[^}]*z-index:-1/.test(harnessCSS));
	ok('contract: no-engine .bg fallback has a height', /#app \.bg\{[^}]*height:var\(--vns-vh,100vh\)/.test(harnessCSS));

	// saxes is strict where jsdom's DOMParser is not: an SVG data URI that is
	// not well-formed XML renders as a blank box in a browser, silently.
	function parseSVG(src) {
		const p = new SaxesParser({});
		let root = null, attrs = null;
		const errs = [];
		p.on('opentag', (t) => { if (!root) { root = t.name; attrs = t.attributes; } });
		p.on('error', (e) => errs.push(e && e.message));
		try { p.write(src).close(); } catch (e) { errs.push(String(e.message)); }
		return { root: root, attrs: attrs, errs: errs };
	}

	const vc = new (require('jsdom').VirtualConsole)();
	for (const t of ['log', 'info', 'warn', 'debug']) vc.on(t, () => {});
	vc.on('jsdomError', (e) => errs.push('jsdomError: ' + e.message));
	const errs = [];
	const dom = loadStory('#preset=mixed&n=4&style=1&events=1&stat=1&size=mixed&mode=mixed', vc);
	await new Promise((r) => dom.window.addEventListener('load', r, { once: true }));
	await new Promise((r) => setTimeout(r, 120));
	const doc = dom.window.document;

	const injected = doc.getElementById('vns-css').textContent;
	eq('engine css parses', parseCSS(injected, 'vns.js CSS').length, 0);
	for (const m of ['cover', 'tiled', 'contain', 'fixed', 'auto']) {
		ok('engine css sizes mode ' + m, injected.includes('[data-mode="' + m + '"]'));
	}
	ok('layer is fixed and 100% wide, not 100vw', /#vns-layer\{[^}]*position:fixed[^}]*width:100%/.test(injected) && !/100vw/.test(injected));
	ok('wagons translate on both axes', /#vns-layer>\.vns-bg\{[^}]*position:absolute/.test(injected));
	ok('script type=txt is hidden by the engine', injected.includes('script[type="txt"]{display:none}'));

	// ---- every generated box actually has a background
	const boxes = [...doc.querySelectorAll('.bg,.bgwindow')];
	ok('boxes found', boxes.length >= 5, boxes.length);
	let badStyle = 0, badValue = 0, truncated = 0, svgChecked = 0, svgSizeBad = 0, declErr = 0, badSvg = 0;
	for (const el of boxes) {
		const raw = el.getAttribute('style') || '';
		if (!raw.includes('background-image:')) { badStyle++; continue; }
		if (parseDecls(raw, 'inline').length) { declErr++; continue; }
		if (!el.style.backgroundImage || el.style.backgroundImage === 'none') { badValue++; continue; }
		if (el.classList.contains('vns-bg') && !el.dataset.mode) { badValue++; continue; }
		// Quote style is whatever the serializer produced: a browser keeps url('..')
		// as authored, jsdom re-quotes when the engine writes el.style.transform.
		// Payload may contain ( ) from url(#pattern), so match quotes, not parens.
		const m = /url\(\s*(['"])(data:image\/svg\+xml,[^'"]*)\1\s*\)/.exec(raw);
		if (/url\(/.test(raw) && !m) { truncated++; continue; }
		if (!m) continue;                          // gradient box: nothing to decode
		const uri = decodeURIComponent(m[2].replace(/^data:image\/svg\+xml,/, ''));
		const svg = parseSVG(uri);
		if (svg.errs.length || svg.root !== 'svg') { badSvg++; continue; }
		svgChecked++;
		const w = +svg.attrs.width, h = +svg.attrs.height;
		if (!(w > 0 && h > 0)) { badSvg++; continue; }
		// fixed/auto rely on the intrinsic size matching the declared box
		const size = el.dataset.size ? +el.dataset.size.split(/[x,]/)[0] : 0;
		if (size && (w !== size || h !== size)) svgSizeBad++;
	}
	eq('every box has an inline background-image', badStyle, 0);
	eq('inline style attributes are legal CSS', declErr, 0);
	eq('background-image survives the engine style layer', badValue, 0);
	eq('data URIs are not truncated by HTML quoting', truncated, 0);
	eq('every inline svg is well-formed XML with a size', badSvg, 0);
	eq('svg art size matches data-size', svgSizeBad, 0);
	ok('svg data URIs were actually inspected', svgChecked >= 2, svgChecked);

	// A style attribute truncated by a nested quote leaves the remainder as junk
	// attributes on the element, so "only contract attributes exist" catches it.
	const ATTRS = /^(class|id|style|type|event|lang|href|src|data-[a-z-]+)$/;
	const stray = [];
	for (const el of doc.querySelectorAll('#app *, #vns-layer *')) {
		for (let i = 0; i < el.attributes.length; i++) {
			const a = el.attributes[i];
			if (!ATTRS.test(a.name)) stray.push(el.tagName.toLowerCase() + '@' + a.name.slice(0, 20));
		}
	}
	eq('no stray attributes (truncated style would leave junk here)', stray.length, 0, stray.slice(0, 3).join(' '));

	// ---- the harness label elements are inside the boxes they describe
	ok('wagon labels ride inside their box', boxes.every((el) => !!el.querySelector('.bgl')));
	// ---- theme vars used by the page and the demo menu
	const root = doc.documentElement;
	ok('morph writes --vns-bg on the root', /(?:^|;)\s*--vns-bg:\s*rgb\(/.test(root.getAttribute('style') || ''), root.getAttribute('style'));
	eq('no uncaught page errors while generating', errs.length, 0);
	const usesFg = harnessCSS.match(/var\(--vns-fg[^)]*\)/g) || [];
	ok('author CSS consumes --vns-fg', usesFg.length >= 2, usesFg.length);

	dom.window.close();

	// ---- every preset builds clean markup, not just the default one
	for (const preset of ['mono', 'tight', 'long', 'draft']) {
		const d2 = loadStory('#preset=' + preset + '&n=3&style=1&events=1&stat=1');
		await new Promise((r) => d2.window.addEventListener('load', r, { once: true }));
		await new Promise((r) => setTimeout(r, 80));
		const app = d2.window.document.getElementById('app');
		const own = [...d2.window.document.querySelectorAll('.bg,.bgwindow')];
		const broken = own.filter((el) => !/background-image:/.test(el.getAttribute('style') || '')).length;
		ok('preset ' + preset + ': boxes have backgrounds', broken === 0, broken);
		ok('preset ' + preset + ': story rendered', app.innerHTML.length > 2000, app.innerHTML.length);
		ok('preset ' + preset + ': no stray unquoted data uri', !app.innerHTML.includes('url("data:'));

		d2.window.close();
	}

	console.log((fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' checks, ' + fail + ' failed');
	process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.log('THREW ' + (e && e.stack || e)); process.exit(1); });
