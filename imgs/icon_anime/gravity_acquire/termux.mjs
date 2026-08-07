/**
 * Termux 采集：`termux-sensor` 经 node:child_process。
 * SensorAPI 以 indent=2 的 pretty JSON + "\\n" 流式写出（非单行 NDJSON）。
 */

import { spawn } from 'node:child_process'

/** 传感器采样间隔（ms）。 */
const SENSOR_DELAY_MS = 100
/** 传感器名回退链。 */
const SENSOR_NAMES = ['gravity', 'Gravity', 'accelerometer']

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
 * @param {(ax: number, ay: number, az: number) => void} onSample 样本回调
 * @returns {() => void} stop
 */
export const start = (onSample) => {
	/** @type {import('node:child_process').ChildProcess | null} */
	let child = null
	/** @type {string} */
	let stdoutBuf = ''
	let sensorIndex = 0
	let dead = false

	/**
	 * 消化 stdout 缓冲。
	 * @returns {void}
	 */
	const drainStdout = () => {
		const { samples, rest } = parseSensorStdout(stdoutBuf)
		stdoutBuf = rest
		for (const [ax, ay, az] of samples) onSample(ax, ay, az)
	}

	/**
	 * 停止当前子进程。
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
	 * 启动指定传感器名。
	 * @param {string} name 传感器名
	 * @returns {void}
	 */
	const spawnSensor = (name) => {
		killChild()
		if (dead) return
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

	spawnSensor(SENSOR_NAMES[0])
	return () => {
		dead = true
		killChild()
		stdoutBuf = ''
	}
}
