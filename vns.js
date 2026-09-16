(function(global) {
	'use strict';

	const DIR_TOP = 0;
	const DIR_BOTTOM = 1;
	const DIR_LEFT = 2;
	const DIR_RIGHT = 3;
	const EVENT_VIEW = 1;
	const EVENT_CENTER = 2;
	const EVENT_PARKED = 4;
	const EVENT_END = 8;
	const EVENT_SKIP = 16;
	const dirCode = { top: DIR_TOP, bottom: DIR_BOTTOM, left: DIR_LEFT, right: DIR_RIGHT };
	const eventCode = { view: EVENT_VIEW, center: EVENT_CENTER, parked: EVENT_PARKED, end: EVENT_END, skip: EVENT_SKIP };

	function clamp(value, low, high) {
		return value < low ? low : value > high ? high : value;
	}

	function ease(value) {
		return value < .5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
	}

	function resolveWagons(scrollY, viewportW, viewportH, anchors, widths, heights, dirs, outX, outY) {
		const count = anchors.length;
		if (!count) return;
		for (let i = count - 1; i >= 0; i--) {
			const free = anchors[i] - scrollY;
			outX[i] = 0;
			outY[i] = free > 0 ? free : 0;
			if (i === count - 1) continue;
			const nextY = outY[i + 1];
			if (nextY >= heights[i]) continue;
			const progress = clamp(1 - nextY / Math.max(1, heights[i]), 0, 1);
			if (dirs[i] === DIR_LEFT) outX[i] = -widths[i] * progress;
			if (dirs[i] === DIR_RIGHT) outX[i] = viewportW * progress;
			if (dirs[i] === DIR_BOTTOM) outY[i] = viewportH * progress;
			if (dirs[i] === DIR_TOP) outY[i] = nextY - heights[i];
		}
	}

	function parseColor(value, fallback) {
		if (!value) return fallback;
		let hex = value.trim();
		if (hex[0] !== '#') return fallback;
		if (hex.length === 4) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
		if (hex.length !== 7) return fallback;
		const parsed = Number.parseInt(hex.slice(1), 16);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	function colorString(a, b, amount) {
		const value = ease(clamp(amount, 0, 1));
		const ar = a >> 16;
		const ag = a >> 8 & 255;
		const ab = a & 255;
		const br = b >> 16;
		const bg = b >> 8 & 255;
		const bb = b & 255;
		const r = Math.round(ar + (br - ar) * value);
		const g = Math.round(ag + (bg - ag) * value);
		const blue = Math.round(ab + (bb - ab) * value);
		return 'rgb(' + r + ' ' + g + ' ' + blue + ')';
	}

	function VNS(options) {
		this.options = options || {};
		this.root = this.options.root || document.documentElement;
		this.scope = this.options.scope || document;
		this.enabled = this.options.enabled !== false;
		this.wagons = [];
		this.anchors = [];
		this.widths = new Float64Array(0);
		this.heights = new Float64Array(0);
		this.dirs = new Uint8Array(0);
		this.x = new Float64Array(0);
		this.y = new Float64Array(0);
		this.top = new Float64Array(0);
		this.styleAnchors = [];
		this.events = [];
		this.eventState = new Uint8Array(0);
		this.lastScroll = global.scrollY || 0;
		this.dirty = true;
		this.framePending = false;
		this.destroyed = false;
		this.stats = { frames: 0, writes: 0, parked: 0, pushed: 0, fired: [0, 0, 0, 0, 0], lastEvent: '' };
		this.onScroll = this.markDirty.bind(this);
		this.onResize = this.refresh.bind(this);
		this.onAnimationFrame = this.frame.bind(this);
		global.addEventListener('scroll', this.onScroll, { passive: true });
		global.addEventListener('resize', this.onResize, { passive: true });
		this.refresh();
	}

	VNS.prototype.markDirty = function() {
		this.dirty = true;
		if (this.framePending || this.destroyed) return;
		this.framePending = true;
		global.requestAnimationFrame(this.onAnimationFrame);
	};

	VNS.prototype.makeAnchor = function(wagon) {
		let anchor = wagon.previousElementSibling;
		if (anchor && anchor.classList.contains('vns-anchor') && anchor.dataset.vnsFor === wagon.dataset.vnsId) return anchor;
		anchor = document.createElement('i');
		anchor.className = 'vns-anchor';
		anchor.setAttribute('aria-hidden', 'true');
		if (!wagon.dataset.vnsId) wagon.dataset.vnsId = String(VNS.nextId++);
		anchor.dataset.vnsFor = wagon.dataset.vnsId;
		wagon.parentNode.insertBefore(anchor, wagon);
		return anchor;
	};

	VNS.prototype.measureSize = function(wagon, mode) {
		const computed = global.getComputedStyle(wagon);
		let width = Number.parseFloat(wagon.dataset.w || wagon.style.width);
		let height = Number.parseFloat(wagon.dataset.h || wagon.style.height);
		if (mode === 'cover' || mode === 'contain') return [global.innerWidth, global.innerHeight];
		if (!Number.isFinite(width) || width <= 0) width = Number.parseFloat(computed.width) || 512;
		if (!Number.isFinite(height) || height <= 0) height = Number.parseFloat(computed.height) || 512;
		return [width, height];
	};

	VNS.prototype.refresh = function() {
		if (this.destroyed) return;
		const wagons = Array.from(this.scope.querySelectorAll('.bg,.bgwindow'));
		const anchors = new Array(wagons.length);
		for (let i = 0; i < wagons.length; i++) anchors[i] = this.makeAnchor(wagons[i]);
		this.wagons = wagons;
		this.anchors = anchors;
		this.widths = new Float64Array(wagons.length);
		this.heights = new Float64Array(wagons.length);
		this.dirs = new Uint8Array(wagons.length);
		this.x = new Float64Array(wagons.length);
		this.y = new Float64Array(wagons.length);
		this.top = new Float64Array(wagons.length);
		for (let i = 0; i < wagons.length; i++) {
			const wagon = wagons[i];
			const mode = wagon.dataset.mode || 'auto';
			const size = this.measureSize(wagon, mode);
			this.widths[i] = size[0];
			this.heights[i] = size[1];
			this.dirs[i] = dirCode[wagon.dataset.dir] === undefined ? DIR_TOP : dirCode[wagon.dataset.dir];
			wagon.style.setProperty('--vns-w', size[0] + 'px');
			wagon.style.setProperty('--vns-h', size[1] + 'px');
			wagon.dataset.vnsIndex = String(i);
		}
		this.refreshStyles();
		this.refreshEvents();
		this.stats.fired.fill(0);
		this.stats.lastEvent = '';
		this.dirty = true;
		this.markDirty();
	};

	VNS.prototype.anchorY = function(index, scrollY) {
		return this.anchors[index].getBoundingClientRect().top + scrollY;
	};

	VNS.prototype.setEnabled = function(enabled) {
		this.enabled = !!enabled;
		this.root.classList.toggle('vns-disabled', !this.enabled);
		for (let i = 0; i < this.wagons.length; i++) this.wagons[i].style.transform = '';
		this.markDirty();
	};

	VNS.prototype.refreshStyles = function() {
		const nodes = Array.from(this.scope.querySelectorAll('[data-bg],[data-fg],[data-style]'));
		this.styleAnchors.length = 0;
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (node.matches('.bg,.bgwindow') && node.dataset.themeAnchor !== 'true') continue;
			this.styleAnchors.push({
				node: node,
				bg: parseColor(node.dataset.bg, -1),
				fg: parseColor(node.dataset.fg, -1),
				style: node.dataset.style || '',
				range: Number.parseFloat(node.dataset.range) || 0,
				y: 0
			});
		}
	};

	VNS.prototype.refreshEvents = function() {
		const scripts = Array.from(this.scope.querySelectorAll('script[type="txt"][event]'));
		this.events.length = 0;
		for (let i = 0; i < scripts.length; i++) {
			const script = scripts[i];
			const type = eventCode[script.getAttribute('event')];
			if (!type) continue;
			let fn;
			try {
				fn = Function('detail', '"use strict";\n' + script.textContent);
			} catch (error) {
				console.error('VNS script compile failed', error);
				continue;
			}
			const section = script.closest('section');
			const anchor = section || script;
			let wagonIndex = -1;
			if (section) {
				const wagon = section.querySelector('.bg,.bgwindow');
				if (wagon) wagonIndex = Number.parseInt(wagon.dataset.vnsIndex, 10);
			}
			this.events.push({ node: anchor, type: type, fn: fn, wagon: wagonIndex, y: 0, h: 1 });
		}
		this.eventState = new Uint8Array(this.events.length);
	};

	VNS.prototype.measureAnchors = function(scrollY) {
		for (let i = 0; i < this.anchors.length; i++) this.y[i] = this.anchorY(i, scrollY);
		for (let i = 0; i < this.styleAnchors.length; i++) this.styleAnchors[i].y = this.styleAnchors[i].node.getBoundingClientRect().top + scrollY;
		for (let i = 0; i < this.events.length; i++) {
			const rect = this.events[i].node.getBoundingClientRect();
			this.events[i].y = rect.top + scrollY;
			this.events[i].h = Math.max(1, rect.height);
		}
	};

	VNS.prototype.renderWagons = function(scrollY) {
		const count = this.wagons.length;
		this.stats.parked = 0;
		this.stats.pushed = 0;
		this.stats.writes = 0;
		if (!this.enabled) {
			for (let i = 0; i < count; i++) {
				this.x[i] = 0;
				this.top[i] = this.y[i];
				const transform = 'translate3d(0px,' + this.y[i].toFixed(3) + 'px,0)';
				if (this.wagons[i].style.transform === transform) continue;
				this.wagons[i].style.transform = transform;
				this.stats.writes++;
			}
			return;
		}
		resolveWagons(scrollY, global.innerWidth, global.innerHeight, this.y, this.widths, this.heights, this.dirs, this.x, this.top);
		for (let i = 0; i < count; i++) {
			const free = this.y[i] - scrollY;
			if (free <= 0 && this.top[i] === 0 && this.x[i] === 0) this.stats.parked++;
			if (this.x[i] !== 0 || this.top[i] < 0 || this.top[i] > 0 && free <= 0) this.stats.pushed++;
			const transform = 'translate3d(' + this.x[i].toFixed(3) + 'px,' + this.top[i].toFixed(3) + 'px,0)';
			if (this.wagons[i].style.transform === transform) continue;
			this.wagons[i].style.transform = transform;
			this.stats.writes++;
		}
	};

	VNS.prototype.renderStyles = function(scrollY) {
		const list = this.styleAnchors;
		if (!list.length) return;
		const cursor = scrollY + global.innerHeight * .5;
		let current = 0;
		for (let i = 1; i < list.length; i++) {
			if (list[i].y > cursor) break;
			current = i;
		}
		const next = Math.min(current + 1, list.length - 1);
		const range = list[current].range || global.innerHeight * .6;
		const amount = next === current ? 0 : clamp((cursor - list[next].y + range) / range, 0, 1);
		let bg0 = list[current].bg;
		let fg0 = list[current].fg;
		let bg1 = list[next].bg;
		let fg1 = list[next].fg;
		if (bg0 < 0) bg0 = bg1 < 0 ? 0x10131a : bg1;
		if (bg1 < 0) bg1 = bg0;
		if (fg0 < 0) fg0 = fg1 < 0 ? 0xf4f1e8 : fg1;
		if (fg1 < 0) fg1 = fg0;
		this.root.style.setProperty('--vns-bg', colorString(bg0, bg1, amount));
		this.root.style.setProperty('--vns-fg', colorString(fg0, fg1, amount));
		const active = amount >= .5 ? list[next] : list[current];
		if (this.activeStyle === active.style) return;
		if (this.activeStyle) {
			const oldClasses = this.activeStyle.split(/\s+/);
			for (let i = 0; i < oldClasses.length; i++) if (oldClasses[i]) this.root.classList.remove(oldClasses[i]);
		}
		this.activeStyle = active.style;
		const classes = active.style.split(/\s+/);
		for (let i = 0; i < classes.length; i++) if (classes[i]) this.root.classList.add(classes[i]);
	};

	VNS.prototype.fireEvent = function(index, type, scrollY) {
		const item = this.events[index];
		const names = ['', 'view', 'center', '', 'parked', '', '', '', 'end', '', '', '', '', '', '', '', 'skip'];
		const name = names[type];
		const detail = { anchor: item.node, event: name, y: item.y, scrollY: scrollY };
		try {
			item.fn(detail);
		} catch (error) {
			console.error('VNS script failed (' + name + ')', error);
		}
		const statIndex = type === EVENT_VIEW ? 0 : type === EVENT_CENTER ? 1 : type === EVENT_PARKED ? 2 : type === EVENT_END ? 3 : 4;
		this.stats.fired[statIndex]++;
		this.stats.lastEvent = name;
	};

	VNS.prototype.renderEvents = function(scrollY) {
		const forward = scrollY >= this.lastScroll;
		const viewportH = global.innerHeight;
		for (let i = 0; i < this.events.length; i++) {
			const item = this.events[i];
			const top = item.y - scrollY;
			const bottom = top + item.h;
			if (!forward) {
				if (top > viewportH + 40) this.eventState[i] = 0;
				continue;
			}
			let state = this.eventState[i];
			const inView = top < viewportH && bottom > 0;
			const atCenter = top <= viewportH * .5 && bottom >= viewportH * .5;
			const parked = item.wagon >= 0 && this.enabled && this.top[item.wagon] === 0 && item.y <= scrollY;
			const past = bottom <= 0;
			if (past && !(state & EVENT_VIEW)) {
				if (item.type === EVENT_SKIP && !(state & EVENT_SKIP)) this.fireEvent(i, EVENT_SKIP, scrollY);
				state |= EVENT_SKIP;
			} else if (inView && !(state & EVENT_VIEW)) {
				if (item.type === EVENT_VIEW) this.fireEvent(i, EVENT_VIEW, scrollY);
				state |= EVENT_VIEW;
			}
			if (atCenter && !(state & EVENT_CENTER)) {
				if (item.type === EVENT_CENTER) this.fireEvent(i, EVENT_CENTER, scrollY);
				state |= EVENT_CENTER;
			}
			if (parked && !(state & EVENT_PARKED)) {
				if (item.type === EVENT_PARKED) this.fireEvent(i, EVENT_PARKED, scrollY);
				state |= EVENT_PARKED;
			}
			if (past && !(state & EVENT_END)) {
				if (item.type === EVENT_END) this.fireEvent(i, EVENT_END, scrollY);
				state |= EVENT_END;
			}
			this.eventState[i] = state;
		}
	};

	VNS.prototype.frame = function() {
		this.framePending = false;
		if (this.destroyed || !this.dirty) return;
		this.dirty = false;
		const scrollY = global.scrollY || 0;
		this.measureAnchors(scrollY);
		this.renderWagons(scrollY);
		this.renderStyles(scrollY);
		this.renderEvents(scrollY);
		this.lastScroll = scrollY;
		this.stats.frames++;
		if (typeof this.options.onFrame === 'function') this.options.onFrame(this);
	};

	VNS.prototype.destroy = function() {
		this.destroyed = true;
		global.removeEventListener('scroll', this.onScroll);
		global.removeEventListener('resize', this.onResize);
	};

	VNS.nextId = 1;
	VNS.resolveWagons = resolveWagons;
	VNS.constants = { DIR_TOP: DIR_TOP, DIR_BOTTOM: DIR_BOTTOM, DIR_LEFT: DIR_LEFT, DIR_RIGHT: DIR_RIGHT };

	if (typeof module !== 'undefined' && module.exports) module.exports = VNS;
	global.VNS = VNS;
})(typeof window !== 'undefined' ? window : globalThis);
