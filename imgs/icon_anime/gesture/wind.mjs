/**
 * 右键风力手势 → 局部气体驱动场。
 *
 * 拖拽：沿路径的定向笔画冲量（拖得越快 → 流场越强）。
 * 长按静止：类龙卷风顺时针涡旋（切向 + 上升气流 + 径向入流）；
 * 按住越久 → 越快；移动时跟随；停止后重组；释放时清除。
 */

import { applyPointer } from './pointer.mjs'

/** 低于此移动量（视图格 / tick）视为静止。 */
export const STILL_EPS = 0.55
/** 涡旋出现前的静止帧数。 */
export const VORTEX_DELAY = 10
/** 涡旋视觉半径（格纵横比 ≈ 1×2 → hypot(dx, 2·dy)）。 */
export const VORTEX_RADIUS = 9
/** 笔画段周围的笔刷半径。 */
export const STROKE_RADIUS = 2.8
/** 拖拽速度（格/tick）→ 气体驱动幅度。 */
export const STROKE_SPEED_SCALE = 0.55
/** 延迟后每 tick 涡旋强度增长。 */
export const VORTEX_GROWTH = 0.14
/** 涡旋切向 / 核心驱动上限。 */
export const VORTEX_MAX = 3.4
/** 上升气流占涡旋强度的比例（y↓ 负值 = 抬升）。 */
export const VORTEX_UPLIFT = 1.05
/** 径向入流占涡旋强度的比例。 */
export const VORTEX_INFLOW = 0.4
/** 笔画轨迹存活 tick 数。 */
export const STROKE_LIFE = 7
/** 最大记忆笔画段数。 */
const STROKE_CAP = 14

/**
 * @typedef {{
 *   x0: number, y0: number, x1: number, y1: number,
 *   ux: number, uy: number, life: number,
 * }} StrokeSeg
 * @typedef {{
 *   down: boolean,
 *   x: number, y: number,
 *   lastX: number, lastY: number,
 *   still: number,
 *   vortexOn: boolean,
 *   strength: number,
 *   strokes: StrokeSeg[],
 * }} WindGesture
 */

/** 回收的笔画段对象。 */
const strokePool = /** @type {StrokeSeg[]} */[]

/**
 * @returns {StrokeSeg} 池化或新建的段
 */
const takeStroke = () => strokePool.pop() || {
	x0: 0, y0: 0, x1: 0, y1: 0, ux: 0, uy: 0, life: 0,
}

/**
 * @param {StrokeSeg} seg 待回收的段
 * @returns {void}
 */
const freeStroke = (seg) => {
	strokePool.push(seg)
}

/**
 * 全新手势状态（释放时亦用于清除）。
 * @returns {WindGesture} 空手势
 */
export const createWindGesture = () => ({
	down: false,
	x: 0, y: 0,
	lastX: 0, lastY: 0,
	still: 0,
	vortexOn: false,
	strength: 0,
	strokes: [],
})

/**
 * 丢弃笔画轨迹与涡旋驱动（保留 `.down`）。
 * @param {WindGesture} gesture 手势
 * @returns {void}
 */
const resetWindDrive = (gesture) => {
	gesture.still = 0
	gesture.vortexOn = false
	gesture.strength = 0
	for (const seg of gesture.strokes) freeStroke(seg)
	gesture.strokes.length = 0
}

/**
 * 清除全部手势驱动（释放 / 重置）。
 * @param {WindGesture} gesture 手势
 * @returns {void}
 */
export const clearWindGesture = (gesture) => {
	gesture.down = false
	resetWindDrive(gesture)
}

/**
 * 处理右键指针事件（按下 / 拖拽 / 释放）。
 * @param {WindGesture} gesture 手势
 * @param {{ x: number, y: number, right: boolean }} ev 右键事件
 * @returns {void}
 */
export const windPointer = (gesture, { x, y, right }) => {
	applyPointer(gesture, x, y, right, {
		/** 按下：锚定笔画并清除先前驱动。 */
		onDown() {
			gesture.lastX = x
			gesture.lastY = y
			resetWindDrive(gesture)
		},
		/** 释放：丢弃笔画 / 涡旋状态。 */
		onUp() {
			clearWindGesture(gesture)
		},
	})
}

/**
 * 推进手势一帧模拟：笔画轨迹 + 涡旋激活 / 增长。
 * 在 `fillWindDrive` 之前每帧调用一次。
 * @param {WindGesture} gesture 手势
 * @returns {void}
 */
export const tickWindGesture = (gesture) => {
	if (!gesture.down) return

	const strokes = gesture.strokes
	for (let index = 0; index < strokes.length;)
		if (--strokes[index].life <= 0) {
			freeStroke(strokes[index])
			strokes[index] = strokes[strokes.length - 1]
			strokes.pop()
		}
		else index++

	const dx = gesture.x - gesture.lastX
	const dy = gesture.y - gesture.lastY
	const dist = Math.hypot(dx, dy)

	if (dist > STILL_EPS) {
		gesture.still = 0
		const inv = 1 / dist
		const amp = dist * STROKE_SPEED_SCALE
		const seg = takeStroke()
		seg.x0 = gesture.lastX
		seg.y0 = gesture.lastY
		seg.x1 = gesture.x
		seg.y1 = gesture.y
		seg.ux = dx * inv * amp
		seg.uy = dy * inv * amp
		seg.life = STROKE_LIFE
		strokes.push(seg)
		if (strokes.length > STROKE_CAP) freeStroke(strokes.shift())
		if (gesture.vortexOn)
			gesture.strength = Math.min(VORTEX_MAX, gesture.strength + VORTEX_GROWTH * 0.35)
	}
	else {
		if (gesture.vortexOn && gesture.still === 0)
			// Just stopped after a drag — reform a clean vortex at the new centre.
			gesture.strength = Math.min(VORTEX_MAX, Math.max(gesture.strength, VORTEX_GROWTH * 4))

		gesture.still++
		if (gesture.still >= VORTEX_DELAY) {
			gesture.vortexOn = true
			gesture.strength = Math.min(VORTEX_MAX, gesture.strength + VORTEX_GROWTH)
		}
	}

	gesture.lastX = gesture.x
	gesture.lastY = gesture.y
}

/**
 * 点 P 到线段 AB 的平方距离（视图格）。
 * @param {number} px 点 x
 * @param {number} py 点 y
 * @param {number} ax 段端点 a x
 * @param {number} ay 段端点 a y
 * @param {number} bx 段端点 b x
 * @param {number} by 段端点 b y
 * @returns {number} 平方距离
 */
const dist2ToSeg = (px, py, ax, ay, bx, by) => {
	const abx = bx - ax
	const aby = by - ay
	const apx = px - ax
	const apy = py - ay
	const ab2 = abx * abx + aby * aby
	if (ab2 < 1e-8) return apx * apx + apy * apy
	let t = (apx * abx + apy * aby) / ab2
	if (t < 0) t = 0
	else if (t > 1) t = 1
	const qx = ax + abx * t - px
	const qy = ay + aby * t - py
	return qx * qx + qy * qy
}

/**
 * 清除先前的风力驱动脏矩形（或整个场）。
 * @param {Float32Array} outUx 水平驱动
 * @param {Float32Array} outUy 垂直驱动
 * @param {number} W 世界宽度
 * @param {number} H 世界高度
 * @param {{ x0: number, y0: number, x1: number, y1: number } | null | undefined} prev 先前脏矩形
 * @returns {void}
 */
const clearDriveRect = (outUx, outUy, W, H, prev) => {
	// null = no history → wipe the whole field; empty rect (x1 < x0) → nothing to clear.
	if (prev == null) {
		outUx.fill(0)
		outUy.fill(0)
		return
	}
	if (prev.x1 < prev.x0) return
	const x0 = Math.max(0, prev.x0)
	const y0 = Math.max(0, prev.y0)
	const x1 = Math.min(W - 1, prev.x1)
	const y1 = Math.min(H - 1, prev.y1)
	for (let y = y0; y <= y1; y++) {
		const row = y * W
		for (let x = x0; x <= x1; x++) {
			outUx[row + x] = 0
			outUy[row + x] = 0
		}
	}
}

/**
 * 将类龙卷风涡旋绘制到驱动缓冲（世界格）。
 * 顺时针切向 + 核心上升气流 + 弱径向入流。
 * @param {number} cx 世界中心 x
 * @param {number} cy 世界中心 y
 * @param {number} amp 强度
 * @param {number} radius 视觉半径
 * @param {{ worldW: number, worldH: number }} world 尺寸
 * @param {Float32Array} outUx 水平驱动
 * @param {Float32Array} outUy 垂直驱动
 * @param {{ x0: number, y0: number, x1: number, y1: number }} [dirty] 待扩展的脏矩形
 * @returns {void}
 */
export const paintVortexDrive = (cx, cy, amp, radius, world, outUx, outUy, dirty) => {
	if (amp < 0.02) return
	const { worldW: W, worldH: H } = world
	const R = radius
	const minX = Math.max(0, Math.floor(cx - R - 1))
	const maxX = Math.min(W - 1, Math.ceil(cx + R + 1))
	const minY = Math.max(0, Math.floor(cy - R * 0.5 - 1))
	const maxY = Math.min(H - 1, Math.ceil(cy + R * 0.5 + 1))
	const uplift = amp * VORTEX_UPLIFT
	const inflow = amp * VORTEX_INFLOW
	if (dirty) {
		if (minX < dirty.x0) dirty.x0 = minX
		if (maxX > dirty.x1) dirty.x1 = maxX
		if (minY < dirty.y0) dirty.y0 = minY
		if (maxY > dirty.y1) dirty.y1 = maxY
	}

	for (let y = minY; y <= maxY; y++)
		for (let x = minX; x <= maxX; x++) {
			const rx = (x + 0.5) - cx
			const ry = (y + 0.5) - cy
			// Tall terminal cells: visual circle via hypot(dx, 2·dy).
			const rVis = Math.hypot(rx, 2 * ry)
			if (rVis > R) continue
			const fall = rVis < 0.35 ? 1 : (1 - rVis / R) ** 1.1
			const rRaw = Math.hypot(rx, ry) || 1
			// Clockwise with y-down: tangential (−ry, rx). Do not halve ty —
			// that downwash on +rx made a right-side hover attractor under gravity.
			const tx = (-ry / rRaw) * amp * fall
			const ty = (rx / rRaw) * amp * fall
			// Inward + updraft so the ring can suspend rain at the centre.
			const ix = (-rx / rRaw) * inflow * fall
			const iy = (-ry / rRaw) * inflow * fall - uplift * fall
			const cell = y * W + x
			outUx[cell] += tx + ix
			outUy[cell] += ty + iy
		}
}

/**
 * 将手势驱动绘制到暂存速度目标（视图 → 世界经 ox/oy）。
 * 仅清除先前脏矩形，而非整个 WH 场。
 * @param {WindGesture} gesture 手势
 * @param {{ worldW: number, worldH: number, ox: number, oy: number, scratch?: Record<string, unknown> }} world 流体世界
 * @param {Float32Array} outUx 水平驱动
 * @param {Float32Array} outUy 垂直驱动
 * @returns {void}
 */
export const fillWindDrive = (gesture, world, outUx, outUy) => {
	const { worldW: W, worldH: H, ox, oy } = world
	const scratch = world.scratch ??= {}
	clearDriveRect(outUx, outUy, W, H, /** @type {{ x0: number, y0: number, x1: number, y1: number } | null} */ scratch.windDirty)
	if (!gesture.down) {
		scratch.windDirty = null
		return
	}

	const dirty = /** @type {{ x0: number, y0: number, x1: number, y1: number }} */
		scratch.windDirtyBox ??= { x0: 0, y0: 0, x1: 0, y1: 0 }

	dirty.x0 = W
	dirty.y0 = H
	dirty.x1 = -1
	dirty.y1 = -1
	const strokeR2 = STROKE_RADIUS * STROKE_RADIUS

	for (const stroke of gesture.strokes) {
		const fade = stroke.life / STROKE_LIFE
		const ux = stroke.ux * fade
		const uy = stroke.uy * fade
		const minX = Math.max(0, Math.floor(Math.min(stroke.x0, stroke.x1) + ox - STROKE_RADIUS - 1))
		const maxX = Math.min(W - 1, Math.ceil(Math.max(stroke.x0, stroke.x1) + ox + STROKE_RADIUS + 1))
		const minY = Math.max(0, Math.floor(Math.min(stroke.y0, stroke.y1) + oy - STROKE_RADIUS - 1))
		const maxY = Math.min(H - 1, Math.ceil(Math.max(stroke.y0, stroke.y1) + oy + STROKE_RADIUS + 1))
		if (minX < dirty.x0) dirty.x0 = minX
		if (maxX > dirty.x1) dirty.x1 = maxX
		if (minY < dirty.y0) dirty.y0 = minY
		if (maxY > dirty.y1) dirty.y1 = maxY
		const ax = stroke.x0 + ox
		const ay = stroke.y0 + oy
		const bx = stroke.x1 + ox
		const by = stroke.y1 + oy
		for (let y = minY; y <= maxY; y++)
			for (let x = minX; x <= maxX; x++) {
				const d2 = dist2ToSeg(x + 0.5, y + 0.5, ax, ay, bx, by)
				if (d2 > strokeR2) continue
				const weight = (1 - d2 / strokeR2) ** 2
				const cell = y * W + x
				outUx[cell] += ux * weight
				outUy[cell] += uy * weight
			}
	}

	if (gesture.vortexOn)
		// Cell centre: SGR coords name the cell; swirl attractor must match that glyph.
		paintVortexDrive(gesture.x + ox + 0.5, gesture.y + oy + 0.5, gesture.strength, VORTEX_RADIUS, world, outUx, outUy, dirty)

	// Empty paint still stores an explicit empty rect (not null) so the next clear skips.
	scratch.windDirty = dirty
}
