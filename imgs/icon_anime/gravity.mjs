/**
 * 重力处理层：平滑单位向量供粒子与网格。
 * 采集由 `gravity_acquire/` 按平台加载（browser / termux / none）。
 */

import { loadAcquire } from './gravity_acquire/index.mjs'

/** 粒子基准加速度（|g|=9.81 时）。 */
export const BASE_PARTICLE_G = 0.12
/** 平面外分量过大时回退默认向下的阈值。 */
const FLAT_RATIO = 0.2
/** 指数平滑系数。 */
const SMOOTH = 0.18
/** 标准重力（m/s²）。 */
const G0 = 9.81

/** @typedef {{
 *   gx: number, gy: number, mag: number,
 * }} GravityState
 */

/**
 * 默认屏幕向下（终端 y↓）。
 * @returns {GravityState} 重力状态
 */
export const defaultGravity = () => ({
	gx: 0,
	gy: 1,
	mag: BASE_PARTICLE_G,
})

/**
 * 设备传感器 → 终端屏幕分量（y↓）。
 * 输入为加速度计 / GravitySensor / accelerationIncludingGravity 约定：
 * 平放面朝上 z≈+g；直立（顶边朝上）y≈+g。
 * @param {number} ax 设备 x（右）
 * @param {number} ay 设备 y（上）
 * @param {number} az 设备 z（出屏）
 * @returns {{ gx: number, gy: number, mag: number } | null} 单位向量 + 粒子加速度；平放返回 null
 */
export const mapSensorToScreen = (ax, ay, az) => {
	const len3 = Math.hypot(ax, ay, az)
	if (!(len3 > 1e-6)) return null
	const flat = Math.hypot(ax, ay) / len3
	if (flat < FLAT_RATIO) return null
	// Accelerometer-style reading A; pull ≈ −A. Device y↑ → terminal y↓:
	// screen = (−Ax, Ay) after mapping pull through the y-flip.
	let sx = -ax
	let sy = ay
	const len2 = Math.hypot(sx, sy)
	if (!(len2 > 1e-6)) return null
	sx /= len2
	sy /= len2
	const norm = len3 / G0
	const mag = BASE_PARTICLE_G * Math.min(2, Math.max(0.4, norm))
	return { gx: sx, gy: sy, mag }
}

/** @type {{ gx: number, gy: number, mag: number }} */
let rawTarget = { gx: 0, gy: 1, mag: BASE_PARTICLE_G }
/** @type {GravityState} */
let live = defaultGravity()
/** @type {(() => void) | null} */
let stopAcquire = null
/** 防止异步 load 与 stop 竞态。 */
let acquireGen = 0

/**
 * 当前平滑后的重力（供动画每帧读取）。
 * @returns {GravityState} 重力
 */
export const currentGravity = () => live

/**
 * 应用原始目标并平滑。
 * @param {{ gx: number, gy: number, mag: number }} target 目标
 * @returns {GravityState} 更新后状态
 */
export const tickGravity = (target = rawTarget) => {
	live.gx += (target.gx - live.gx) * SMOOTH
	live.gy += (target.gy - live.gy) * SMOOTH
	live.mag += (target.mag - live.mag) * SMOOTH
	const len = Math.hypot(live.gx, live.gy)
	if (len > 1e-6) {
		live.gx /= len
		live.gy /= len
	}
	else {
		live.gx = 0
		live.gy = 1
	}
	return live
}

/**
 * 将传感器读数写入 rawTarget。
 * @param {number} ax x
 * @param {number} ay y
 * @param {number} az z
 * @returns {void}
 */
const applySample = (ax, ay, az) => {
	const mapped = mapSensorToScreen(ax, ay, az)
	if (!mapped) return
	rawTarget = mapped
}

/**
 * 开始读取设备重力（无采集后端时保持默认）。
 * @param {{ loadAcquire?: typeof loadAcquire }} [deps] 可注入采集加载（测试）
 * @returns {void}
 */
export const startGravity = (deps = {}) => {
	const loader = deps.loadAcquire ?? loadAcquire
	live = defaultGravity()
	rawTarget = defaultGravity()
	stopGravity()
	const gen = ++acquireGen
	void loader().then((mod) => {
		if (gen !== acquireGen) return
		const stop = mod.start(applySample)
		// stopGravity 可能在 start() 同步路径里发生：立刻释放，勿留下孤儿采集。
		if (gen !== acquireGen) {
			stop()
			return
		}
		stopAcquire = stop
	})
}

/**
 * 停止采集。
 * @returns {void}
 */
export const stopGravity = () => {
	acquireGen++
	stopAcquire?.()
	stopAcquire = null
}

/**
 * 测试/注入：直接设定目标重力（跳过传感器）。
 * @param {{ gx: number, gy: number, mag?: number }} vec 向量
 * @returns {void}
 */
export const setGravityTarget = (vec) => {
	const len = Math.hypot(vec.gx, vec.gy) || 1
	rawTarget = {
		gx: vec.gx / len,
		gy: vec.gy / len,
		mag: vec.mag ?? BASE_PARTICLE_G,
	}
	live.gx = rawTarget.gx
	live.gy = rawTarget.gy
	live.mag = rawTarget.mag
}
