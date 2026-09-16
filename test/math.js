'use strict';

const assert = require('node:assert/strict');
const VNS = require('../vns.js');
const C = VNS.constants;

function resolve(scroll, anchors, widths, heights, dirs, viewportW, viewportH) {
	const x = new Float64Array(anchors.length);
	const y = new Float64Array(anchors.length);
	VNS.resolveWagons(scroll, viewportW || 1000, viewportH || 700, Float64Array.from(anchors), Float64Array.from(widths), Float64Array.from(heights), Uint8Array.from(dirs), x, y);
	return { x: Array.from(x), y: Array.from(y) };
}

const right = resolve(1000, [100, 1000], [80, 300], [40, 200], [C.DIR_RIGHT, C.DIR_TOP]);
assert.equal(right.x[0], 1000, 'small right-moving wagon must fully clear viewport');
assert.equal(right.y[0], 0);

const left = resolve(1000, [100, 1000], [80, 300], [40, 200], [C.DIR_LEFT, C.DIR_TOP]);
assert.equal(left.x[0], -80, 'left-moving wagon clears by its own width');

const top = resolve(900, [100, 600, 1000], [100, 100, 100], [500, 500, 500], [C.DIR_TOP, C.DIR_TOP, C.DIR_TOP]);
for (let i = 0; i < top.y.length - 1; i++) assert.ok(top.y[i] + 500 <= top.y[i + 1], 'top wagons do not overlap');

for (let scroll = 0; scroll <= 1400; scroll += 7) {
	const a = resolve(scroll, [100, 600, 1000], [90, 300, 200], [80, 400, 250], [C.DIR_RIGHT, C.DIR_TOP, C.DIR_LEFT]);
	const b = resolve(scroll, [100, 600, 1000], [90, 300, 200], [80, 400, 250], [C.DIR_RIGHT, C.DIR_TOP, C.DIR_LEFT]);
	assert.deepEqual(a, b, 'layout is a pure function of scroll position');
}

console.log('math.js — PASS');
