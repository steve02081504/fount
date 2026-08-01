/**
 * 左键光照手势 → 手电筒聚光或点击涟漪。
 *
 * 按住超过 TORCH_DELAY → 圆形冷色手电（拖拽时跟随），
 * 环境变暗 + 中心提亮在 TORCH_FADE 帧内渐入/渐出。
 * 更快释放（手电筒未激活前）→ 高亮环向外扩散。
 */

import { applyPointer, trimCap } from './pointer.mjs'

/** 手电筒激活前的按住帧数。 */
export const TORCH_DELAY = 5
/** torchBlend 0↔1 渐变速率帧数（进入 / 退出）。 */
export const TORCH_FADE = 10
/** 涟漪扩散速度（视觉半径单位 / tick；纵横比 via hypot(dx, 2·dy)）。 */
export const RIPPLE_SPEED = 1.85
/** 涟漪环的软半宽。 */
export const RIPPLE_WIDTH = 2.4
/** 涟漪存活 tick 数。 */
export const RIPPLE_LIFE = 20
/** 环峰值增益（>1 → 比手电中心更亮）。 */
export const RIPPLE_GAIN = 1.35
/** 最大并发涟漪数。 */
const RIPPLE_CAP = 6

/**
 * @typedef {{ x: number, y: number, age: number, life: number }} LightRipple
 * @typedef {{
 *   down: boolean,
 *   x: number, y: number,
 *   held: number,
 *   torch: boolean,
 *   torchBlend: number,
 *   ripples: LightRipple[],
 * }} LightGesture
 */

/**
 * 全新的光照手势状态。
 * @returns {LightGesture} 空手势
 */
export const createLightGesture = () => ({
	down: false,
	x: 0, y: 0,
	held: 0,
	torch: false,
	torchBlend: 0,
	ripples: [],
})

/**
 * 软环衰减：波前峰值，中心/外侧为零。
 * @param {number} dx 距原点的列数
 * @param {number} dy 距原点的行数
 * @param {number} radius 视觉环半径
 * @param {number} [width] 软半宽
 * @returns {number} 0..1 强度
 */
export const rippleFalloff = (dx, dy, radius, width = RIPPLE_WIDTH) => {
	const r = Math.sqrt(dx * dx + 4 * dy * dy)
	const d = Math.abs(r - radius)
	if (d >= width) return 0
	const t = 1 - d / width
	return t * t
}

/**
 * 光照用 torchBlend 缓动（smoothstep）。
 * @param {number} t 线性 0..1
 * @returns {number} 缓动后 0..1
 */
export const torchEase = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)

/**
 * 处理左键指针事件（按下 / 拖拽 / 释放）。
 * @param {LightGesture} gesture 手势
 * @param {{ x: number, y: number, left: boolean }} ev 左键事件
 * @returns {void}
 */
export const lightPointer = (gesture, { x, y, left }) => {
	applyPointer(gesture, x, y, left, {
		/** 按下：恢复手电渐隐或重置按住计时。 */
		onDown() {
			// Resume mid fade-out without waiting TORCH_DELAY again.
			if (gesture.torchBlend > 0) {
				gesture.held = TORCH_DELAY
				gesture.torch = true
			}
			else {
				gesture.held = 0
				gesture.torch = false
			}
		},
		/** 释放：若手电未激活则生成涟漪。 */
		onUp() {
			if (!gesture.torch) {
				gesture.ripples.push({ x: gesture.x, y: gesture.y, age: 0, life: RIPPLE_LIFE })
				trimCap(gesture.ripples, RIPPLE_CAP)
				gesture.torchBlend = 0
			}
			gesture.held = 0
			gesture.torch = false
		},
	})
}

/**
 * 推进手势一帧模拟：激活手电、混合渐隐、涟漪老化。
 * @param {LightGesture} gesture 手势
 * @returns {void}
 */
export const tickLightGesture = (gesture) => {
	const { ripples } = gesture
	for (let index = ripples.length - 1; index >= 0; index--) {
		const ripple = ripples[index]
		if (++ripple.age >= ripple.life) ripples.splice(index, 1)
	}

	if (gesture.down) {
		gesture.held++
		if (gesture.held >= TORCH_DELAY) gesture.torch = true
	}

	const target = +(gesture.down && gesture.torch)
	if (gesture.torchBlend === target) return
	gesture.torchBlend = target > gesture.torchBlend
		? Math.min(target, gesture.torchBlend + 1 / TORCH_FADE)
		: Math.max(target, gesture.torchBlend - 1 / TORCH_FADE)
}

/** sampleLight 未传入 out 时的默认输出槽。 */
const defaultSampleOut = { ambient: 0, lift: 0 }

/**
 * 视图格点的综合提亮（手电填充 + 涟漪环）。
 * 写入 `out`（默认复用模块槽）以避免每格分配。
 * `ambient` 为手电变暗强度 0..1（缓动后）；涟漪不设置 ambient。
 * @param {LightGesture} gesture 手势
 * @param {number} x 视图列
 * @param {number} y 视图行
 * @param {(dx: number, dy: number, radius?: number) => number} torchFalloff 径向填充
 * @param {{ ambient: number, lift: number }} [out] 采样输出
 * @returns {{ ambient: number, lift: number }} 光照采样
 */
export const sampleLight = (gesture, x, y, torchFalloff, out = defaultSampleOut) => {
	let lift = 0
	const ambient = torchEase(gesture.torchBlend)
	if (ambient > 0) lift = torchFalloff(x - gesture.x, y - gesture.y) * ambient

	for (const ripple of gesture.ripples) {
		const fade = (1 - ripple.age / ripple.life) ** 1.2
		const ring = rippleFalloff(x - ripple.x, y - ripple.y, ripple.age * RIPPLE_SPEED) * fade * RIPPLE_GAIN
		if (ring > lift) lift = ring
	}
	out.ambient = ambient
	out.lift = lift
	return out
}
