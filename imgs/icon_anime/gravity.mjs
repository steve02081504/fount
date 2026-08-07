/**
 * 设备重力：Termux 经 node:child_process 读 termux-sensor；否则默认屏幕向下。
 * 连续单位向量供粒子与网格（投影深度 / 加权邻格 / 边角色）。
 */

import { spawn } from 'node:child_process'

import { in_termux } from '../../src/scripts/env.mjs'

/** 粒子基准加速度（|g|=9.81 时）。 */
export const BASE_PARTICLE_G = 0.12
/** 平面外分量过大时回退默认向下的阈值。 */
const FLAT_RATIO = 0.2
/** 指数平滑系数。 */
const SMOOTH = 0.18
/** 传感器采样间隔（ms）。 */
const SENSOR_DELAY_MS = 100
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
 * Android 传感器 → 终端屏幕分量（y↓）。
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
	// Device y↑ → terminal y↓ → screen_gy ∝ -ay
	let sx = ax
	let sy = -ay
	const len2 = Math.hypot(sx, sy)
	if (!(len2 > 1e-6)) return null
	sx /= len2
	sy /= len2
	const norm = len3 / G0
	const mag = BASE_PARTICLE_G * Math.min(2, Math.max(0.4, norm))
	return { gx: sx, gy: sy, mag }
}

/**
 * 从 termux-sensor JSON 取出 [x,y,z]。
 * @param {unknown} data 解析后的对象
 * @returns {[number, number, number] | null} 三轴
 */
const valuesFromSensorJson = (data) => {
	if (!data || typeof data !== 'object') return null
	const obj = /** @type {Record<string, unknown>} */ data
	for (const key of Object.keys(obj)) {
		const entry = obj[key]
		if (!entry || typeof entry !== 'object') continue
		const values = /** @type {{ values?: unknown }} */ entry.values
		if (!Array.isArray(values) || values.length < 3) continue
		const x = +values[0]
		const y = +values[1]
		const z = +values[2]
		if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))
			return [x, y, z]
	}
	return null
}

/** @type {import('node:child_process').ChildProcess | null} */
let child = null
/** @type {string} */
let stdoutBuf = ''
/** @type {{ gx: number, gy: number, mag: number }} */
let rawTarget = { gx: 0, gy: 1, mag: BASE_PARTICLE_G }
/** @type {GravityState} */
let live = defaultGravity()
/** 传感器名回退链。 */
const SENSOR_NAMES = ['gravity', 'Gravity', 'accelerometer']
let sensorIndex = 0

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
 * 解析单条 termux-sensor JSON 并写入 rawTarget。
 * @param {string} chunk JSON 文本
 * @returns {void}
 */
const emitSensorJson = (chunk) => {
	try {
		const vals = valuesFromSensorJson(JSON.parse(chunk))
		if (vals) applySample(vals[0], vals[1], vals[2])
	}
	catch { /* malformed record */ }
}

/**
 * 处理 stdout 缓冲：先按行（NDJSON），再对残余缓冲尝试完整 JSON 对象。
 * termux-sensor 连续模式为对象流，可能带换行也可能粘连。
 * @returns {void}
 */
const drainStdout = () => {
	let lineEnd
	while ((lineEnd = stdoutBuf.indexOf('\n')) >= 0) {
		const line = stdoutBuf.slice(0, lineEnd).trim()
		stdoutBuf = stdoutBuf.slice(lineEnd + 1)
		if (line) emitSensorJson(line)
	}

	let i = 0
	while (i < stdoutBuf.length) {
		const open = stdoutBuf.indexOf('{', i)
		if (open < 0) {
			stdoutBuf = stdoutBuf.slice(i)
			return
		}
		let parsed = false
		for (let end = open + 2; end <= stdoutBuf.length; end++) {
			if (stdoutBuf[end - 1] !== '}') continue
			const chunk = stdoutBuf.slice(open, end)
			try {
				JSON.parse(chunk)
				emitSensorJson(chunk)
				i = end
				parsed = true
				break
			}
			catch { /* incomplete or nested — try longer slice */ }
		}
		if (!parsed) {
			stdoutBuf = stdoutBuf.slice(open)
			return
		}
	}
	stdoutBuf = stdoutBuf.slice(i)
}

/**
 * 启动指定传感器名的子进程。
 * @param {string} name 传感器名
 * @returns {void}
 */
const spawnSensor = (name) => {
	stopGravity()
	if (!in_termux) return
	try {
		child = spawn('termux-sensor', ['-s', name, '-d', String(SENSOR_DELAY_MS)], {
			stdio: ['ignore', 'pipe', 'ignore'],
		})
	}
	catch {
		child = null
		return
	}
	stdoutBuf = ''
	child.stdout?.setEncoding('utf8')
	child.stdout?.on('data', (chunk) => {
		stdoutBuf += chunk
		drainStdout()
	})
	child.on('exit', (code) => {
		child = null
		if (code !== 0 && sensorIndex + 1 < SENSOR_NAMES.length) {
			sensorIndex++
			spawnSensor(SENSOR_NAMES[sensorIndex])
		}
	})
	child.on('error', () => {
		child = null
	})
}

/**
 * 开始读取设备重力（非 Termux 为 no-op，保持默认）。
 * @returns {void}
 */
export const startGravity = () => {
	live = defaultGravity()
	rawTarget = { gx: 0, gy: 1, mag: BASE_PARTICLE_G }
	sensorIndex = 0
	if (!in_termux) return
	spawnSensor(SENSOR_NAMES[0])
}

/**
 * 停止传感器子进程。
 * @returns {void}
 */
export const stopGravity = () => {
	if (!child) return
	const proc = child
	child = null
	proc.stdout?.removeAllListeners('data')
	proc.removeAllListeners('exit')
	proc.removeAllListeners('error')
	try {
		proc.kill()
	}
	catch { /* already dead */ }
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
