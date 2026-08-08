/**
 * Termux 采集：`termux-sensor` 经 node:child_process。
 * SensorAPI 以 indent=2 的 pretty JSON + "\\n" 流式写出（非单行 NDJSON）。
 *
 * 停采必须先 `termux-sensor -c` 再 kill 流式 CLI：SensorAPI 把 listener 挂在
 * Termux:API 里；只杀 CLI 会弄断 socket、把 outputWriter 置空却不 unregister，
 * 之后再 -c 会走 “cleanup unnecessary”，传感器一直占着（需强杀两个 app）。
 */

import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'

/** 传感器采样间隔（ms）。 */
const SENSOR_DELAY_MS = 100
/** 传感器名回退链。 */
const SENSOR_NAMES = ['gravity', 'Gravity', 'accelerometer']
/** `termux-sensor -c` 超时（ms）。 */
const CLEANUP_TIMEOUT_MS = 3000

/**
 * @typedef {{
 *   spawn?: typeof spawn,
 *   spawnSync?: typeof spawnSync,
 *   process?: { on: Function, off: Function },
 * }} TermuxAcquireDeps
 */

/**
 * 从 termux-sensor JSON 取出 [x,y,z]。
 * @param {unknown} data 解析后的对象
 * @returns {[number, number, number] | null} 三轴
 */
export const valuesFromSensorJson = (data) => {
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

/**
 * 从 termux-sensor stdout 缓冲抽出完整样本。
 * @param {string} buf 累积缓冲
 * @returns {{ samples: [number, number, number][], rest: string }} 样本与残余
 */
export const parseSensorStdout = (buf) => {
	/** @type {[number, number, number][]} */
	const samples = []
	let i = 0
	while (i < buf.length) {
		const open = buf.indexOf('{', i)
		if (open < 0) return { samples, rest: '' }
		let parsed = false
		for (let end = open + 2; end <= buf.length; end++) {
			if (buf[end - 1] !== '}') continue
			const chunk = buf.slice(open, end)
			try {
				const vals = valuesFromSensorJson(JSON.parse(chunk))
				if (vals) samples.push(vals)
				i = end
				parsed = true
				break
			}
			catch { /* incomplete or nested — try longer slice */ }
		}
		if (!parsed) return { samples, rest: buf.slice(open) }
	}
	return { samples, rest: buf.slice(i) }
}

/**
 * 释放 Termux:API 侧传感器（须在杀掉流式 CLI 之前调用）。
 * @param {typeof spawnSync} [doSpawnSync] spawnSync 实现
 * @returns {void}
 */
export const releaseSensors = (doSpawnSync = spawnSync) => {
	try {
		doSpawnSync('termux-sensor', ['-c'], {
			stdio: 'ignore',
			timeout: CLEANUP_TIMEOUT_MS,
		})
	}
	catch { /* missing binary / timeout */ }
}

/**
 * @param {(ax: number, ay: number, az: number) => void} onSample 样本回调
 * @param {TermuxAcquireDeps} [deps] 可注入（测试）
 * @returns {() => void} stop
 */
export const start = (onSample, deps = {}) => {
	const doSpawn = deps.spawn ?? spawn
	const doSpawnSync = deps.spawnSync ?? spawnSync
	const procApi = deps.process ?? process
	/** @type {import('node:child_process').ChildProcess | null} */
	let child = null
	/** @type {string} */
	let stdoutBuffer = ''
	let sensorIndex = 0
	let dead = false

	/**
	 * 消化 stdout 缓冲。
	 * @returns {void}
	 */
	const drainStdout = () => {
		const { samples, rest } = parseSensorStdout(stdoutBuffer)
		stdoutBuffer = rest
		for (const [ax, ay, az] of samples) onSample(ax, ay, az)
	}

	/**
	 * 停止当前子进程（不触碰 SensorAPI）。
	 * @returns {void}
	 */
	const killChild = () => {
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
	 * 先 -c 释放 Termux:API listener，再杀流式 CLI。
	 * @returns {void}
	 */
	const releaseThenKill = () => {
		releaseSensors(doSpawnSync)
		killChild()
	}

	/**
	 * 启动指定传感器名。
	 * @param {string} name 传感器名
	 * @returns {void}
	 */
	const spawnSensor = (name) => {
		releaseThenKill()
		if (dead) return
		try {
			child = doSpawn('termux-sensor', ['-s', name, '-d', String(SENSOR_DELAY_MS)], {
				stdio: ['ignore', 'pipe', 'ignore'],
			})
		}
		catch {
			child = null
			return
		}
		stdoutBuffer = ''
		child.stdout?.setEncoding('utf8')
		child.stdout?.on('data', (chunk) => {
			stdoutBuffer += chunk
			drainStdout()
		})
		child.on('exit', (code) => {
			child = null
			if (dead) return
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
	 * 进程退出兜底：仍须先 -c 再 kill。
	 * @returns {void}
	 */
	const onProcessExit = () => {
		dead = true
		releaseThenKill()
	}
	procApi.on('exit', onProcessExit)

	spawnSensor(SENSOR_NAMES[0])
	return () => {
		dead = true
		procApi.off('exit', onProcessExit)
		releaseThenKill()
		stdoutBuffer = ''
	}
}
