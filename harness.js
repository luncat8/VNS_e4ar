(function() {
	'use strict';

	const $ = id => document.getElementById(id);
	const palette = [
		['#b92b3d', '#38101a'], ['#2864c7', '#0b1836'], ['#2f9364', '#0c2b20'],
		['#d69a28', '#432908'], ['#824ec2', '#241035'], ['#d9d5c8', '#34322d'],
		['#1da5a5', '#073232'], ['#d55c2c', '#3d1608']
	];
	const modes = ['cover', 'contain', 'fixed', 'original', 'contain', 'auto'];
	const directions = ['top', 'left', 'right', 'bottom'];
	let engine;
	let framesAtLastPaint = 0;
	let lastPaint = performance.now();
	let fps = 0;
	window.__eventLog = [];

	function pattern(index) {
		const colors = palette[index % palette.length];
		const angle = 25 + index * 31;
		return 'radial-gradient(circle at ' + (20 + index * 11 % 70) + '% 30%,#ffffff55 0 8%,transparent 9%),repeating-linear-gradient(' + angle + 'deg,' + colors[0] + ' 0 38px,' + colors[1] + ' 39px 76px)';
	}

	function lineCount(index, gap) {
		if (gap === 'tiny') return 16 + index % 3 * 4;
		if (gap === 'huge') return 110 + index % 3 * 35;
		return [22, 67, 34, 96, 45, 78, 29, 105][index % 8];
	}

	function modeFor(index, selected) {
		return selected === 'matrix' ? modes[index % modes.length] : selected;
	}

	function directionFor(index, selected) {
		return selected === 'matrix' ? directions[index % directions.length] : selected;
	}

	function storyMarkup() {
		const count = Number.parseInt($('count').value, 10);
		const gap = $('gap').value;
		const selectedMode = $('mode').value;
		const selectedDirection = $('direction').value;
		const output = [];
		for (let i = 0; i < count; i++) {
			const number = i + 1;
			const mode = modeFor(i, selectedMode);
			const direction = directionFor(i, selectedDirection);
			const width = mode === 'fixed' ? 180 + i % 3 * 90 : mode === 'original' ? 260 + i % 3 * 130 : mode === 'auto' ? 360 : 512;
			const height = mode === 'fixed' ? 120 + i % 2 * 100 : mode === 'original' ? 180 + i % 3 * 100 : mode === 'auto' ? 220 : 512;
			const colors = palette[i % palette.length];
			const styleClass = i % 3 === 0 ? 'night' : i % 3 === 1 ? 'day' : 'fog';
			output.push('<section class="chapter" data-bg="' + colors[1] + '" data-fg="#f4f1e8" data-style="' + styleClass + '" data-range="500">');
			output.push('<i class="bg" data-mode="' + mode + '" data-dir="' + direction + '" data-w="' + width + '" data-h="' + height + '" style="background-image:' + pattern(i) + '"></i>');
			output.push('<h2 class="chapter-title">' + number + '</h2>');
			output.push('<div class="chapter-note">BG ' + number + ' · ' + mode + ' ' + width + '×' + height + ' · exits ' + direction + (mode === 'auto' ? '<br><b>AUTO #6:</b> deliberately tests a small natural-size background behind this text.' : '') + '</div>');
			const lines = lineCount(i, gap);
			for (let line = 0; line < lines; line++) output.push('<div class="story-line">' + String.fromCharCode(65 + i) + ' · chapter ' + number + ' · line ' + (line + 1) + '</div>');
			output.push('<script type="txt" event="view">window.__eventLog.push("' + number + ' view");document.documentElement.dataset.last="' + number + ' view";</script>');
			output.push('<script type="txt" event="center">window.__eventLog.push("' + number + ' center");document.documentElement.dataset.last="' + number + ' center";</script>');
			output.push('<script type="txt" event="parked">window.__eventLog.push("' + number + ' parked");document.documentElement.dataset.last="' + number + ' parked";</script>');
			output.push('<script type="txt" event="end">window.__eventLog.push("' + number + ' end");document.documentElement.dataset.last="' + number + ' end";</script>');
			output.push('<script type="txt" event="skip">window.__eventLog.push("' + number + ' skip");document.documentElement.dataset.last="' + number + ' skip";</script>');
			output.push('</section>');
		}
		return output.join('');
	}

	function regenerate(event) {
		if (event) event.preventDefault();
		window.scrollTo(0, 0);
		window.__eventLog.length = 0;
		$('story').innerHTML = storyMarkup();
		if (!engine) {
			engine = new VNS({ scope: $('story'), onFrame: updateDiagnostics });
			window.vns = engine;
		} else {
			engine.refresh();
		}
		engine.setEnabled($('enabled').checked);
		updateHash();
		updateDiagnostics(engine);
	}

	function updateHash() {
		const values = [$('count').value, $('gap').value, $('mode').value, $('direction').value, $('enabled').checked ? '1' : '0'];
		history.replaceState(null, '', '#' + values.join('/'));
	}

	function restoreHash() {
		const values = location.hash.slice(1).split('/');
		if (values.length !== 5) return;
		$('count').value = values[0];
		$('gap').value = values[1];
		$('mode').value = values[2];
		$('direction').value = values[3];
		$('enabled').checked = values[4] !== '0';
	}

	function updateDiagnostics(instance) {
		if (!instance) return;
		const now = performance.now();
		if (now - lastPaint > 500) {
			fps = Math.round((instance.stats.frames - framesAtLastPaint) * 1000 / (now - lastPaint));
			framesAtLastPaint = instance.stats.frames;
			lastPaint = now;
		}
		const events = instance.stats.fired;
		$('diag').textContent =
			'scrollY ' + Math.round(scrollY) + '   vh ' + innerHeight + '   doc ' + document.documentElement.scrollHeight + '\n' +
			'wagons ' + instance.wagons.length + '   parked ' + instance.stats.parked + '   pushed ' + instance.stats.pushed + '\n' +
			'engine ' + (instance.enabled ? 'on' : 'off (images remain behind text)') + '   frames/s ' + fps + '   writes ' + instance.stats.writes + '\n' +
			'fired  view ' + events[0] + '  center ' + events[1] + '  parked ' + events[2] + '  end ' + events[3] + '  skip ' + events[4] + '\n' +
			'last event: ' + (instance.stats.lastEvent || 'none') + '   data-last=' + document.documentElement.dataset.last;
	}

	function addResult(lines, pass, title, detail) {
		lines.push((pass ? '✔ ' : '✘ ') + title);
		lines.push('  ' + detail);
		return pass;
	}

	function runQa() {
		const lines = ['VNS · QA', ''];
		let all = true;
		const anchors = new Float64Array([100, 1000, 1800]);
		const widths = new Float64Array([120, 500, 300]);
		const heights = new Float64Array([80, 400, 200]);
		const dirs = new Uint8Array([VNS.constants.DIR_RIGHT, VNS.constants.DIR_TOP, VNS.constants.DIR_LEFT]);
		const x = new Float64Array(3);
		const y = new Float64Array(3);
		VNS.resolveWagons(1000, innerWidth, innerHeight, anchors, widths, heights, dirs, x, y);
		all = addResult(lines, Math.abs(x[0] - innerWidth) < .001, 'small right-exit reaches completely off-screen', 'x=' + x[0].toFixed(1) + ', required=' + innerWidth) && all;
		const firstX = x[0];
		VNS.resolveWagons(1000, innerWidth, innerHeight, anchors, widths, heights, dirs, x, y);
		all = addResult(lines, x[0] === firstX, 'reversibility · same scroll gives same transform', 'right wagon x=' + x[0].toFixed(1)) && all;
		let worstAnchor = 0;
		for (let i = 0; i < engine.wagons.length; i++) {
			const expected = engine.anchors[i].getBoundingClientRect().top + scrollY;
			const sectionY = engine.wagons[i].closest('section').getBoundingClientRect().top + scrollY;
			worstAnchor = Math.max(worstAnchor, Math.abs(expected - sectionY));
		}
		all = addResult(lines, worstAnchor <= 1, 'anchor alignment', 'worst DOM error ' + worstAnchor.toFixed(2) + 'px') && all;
		const disabledRule = Array.from(document.styleSheets[0].cssRules).some(function(rule) { return rule.selectorText && rule.selectorText.indexOf('.vns-disabled .bg') >= 0 && rule.style.position === 'absolute'; });
		all = addResult(lines, disabledRule, 'engine=0 keeps backgrounds behind text', 'absolute decoration layer; no in-flow image blocks') && all;
		all = addResult(lines, document.querySelectorAll('script[type="txt"]').length === engine.wagons.length * 5, 'event fixtures present', engine.events.length + ' compiled scripts') && all;
		lines.push('', all ? 'all checks green' : 'one or more checks failed');
		$('diag').textContent = lines.join('\n');
		console.log(lines.join('\n'));
	}

	restoreHash();
	$('controls').addEventListener('submit', regenerate);
	$('enabled').addEventListener('change', function() {
		engine.setEnabled(this.checked);
		updateHash();
	});
	$('qa').addEventListener('click', runQa);
	regenerate();
})();
