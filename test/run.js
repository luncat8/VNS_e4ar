// test/run.js — runs every gate, reports one line each.
// `node test/run.js`  (math.js needs nothing; dom.js, page.js and assets.js are
// dev-only gates needing `npm i jsdom css-tree saxes` — the engine itself has no
// deps, no build step and no modules)

const { spawnSync } = require('child_process');
const path = require('path');

const ALL = ['math.js', 'dom.js', 'page.js', 'assets.js'];
const tests = ALL.filter((f) => {
	if (f === 'math.js') return true;
	try { for (const d of ['jsdom', 'css-tree', 'saxes']) require.resolve(d, { paths: [path.join(__dirname, '..', '..'), __dirname] }); return true; }
	catch (e) { console.log('SKIP  ' + f + ' — dev deps missing (`npm i jsdom css-tree saxes`)'); return false; }
});

let bad = 0;
for (const f of tests) {
	const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
	const out = (r.stdout || '').trim().split('\n');
	const last = out[out.length - 1] || '(no output)';
	if (r.status !== 0) { bad++; console.log('FAIL  ' + f + ' — ' + last); console.log(out.slice(0, -1).slice(-12).map((l) => '      ' + l).join('\n')); }
	else console.log('ok    ' + f + ' — ' + last);
}
console.log(bad ? bad + ' gate(s) failed' : 'all ' + tests.length + ' gates green');
process.exit(bad ? 1 : 0);
