/**
 * 浏览器采集：优先 GravitySensor（Generic Sensor），回落 DeviceMotionEvent。
 * 需安全上下文（HTTPS / localhost）；iOS 13+ 可能要 requestPermission（需用户手势）。
 *
 * 坐标：与 Android / termux 加速度计一致（平放面朝上 z≈+9.8；直立 y≈+9.8），
 * 由处理层 mapSensorToScreen 映射到终端屏幕。
 */

/** 目标采样频率（Hz），约 100ms。 */
const FREQUENCY = 10

/**
 * 尝试 Permissions API（accelerometer；GravitySensor 同源）。
 * @returns {Promise<boolean>} 是否可继续（无 Permissions API 时视为 true）
 */
const ensureAccelerometerPermission = async () => {
	const perms = globalThis.navigator?.permissions
	if (!perms?.query) return true
	try {
		const status = await perms.query({
			name: /** @type {PermissionName} */ 'accelerometer',
		})
		return status.state !== 'denied'
	}
	catch {
		return true
	}
}

/**
 * iOS：DeviceMotionEvent.requestPermission（须在用户手势中才稳定成功）。
 * @returns {Promise<boolean>} 是否 granted / 无需请求
 */
const ensureDeviceMotionPermission = async () => {
	const DME = globalThis.DeviceMotionEvent
	const req = DME && /** @type {{ requestPermission?: () => Promise<string> }} */ DME.requestPermission
	if (typeof req !== 'function') return true
	try {
		return await req.call(DME) === 'granted'
	}
	catch {
		return false
	}
}

/**
 * 从三轴对象取有限数值。
 * @param {{ x?: number | null, y?: number | null, z?: number | null } | null | undefined} v 矢量
 * @returns {[number, number, number] | null} 三轴
 */
const xyz = (v) => {
	if (!v) return null
	const x = +v.x, y = +v.y, z = +v.z
	if (![x, y, z].every(Number.isFinite)) return null
	return [x, y, z]
}

/**
 * GravitySensor（Chromium）。
 * @param {(ax: number, ay: number, az: number) => void} onSample 回调
 * @returns {Promise<(() => void) | null>} stop；不可用则 null
 */
const startGravitySensor = async (onSample) => {
	const Ctor = /** @type {undefined | (new (opts?: { frequency?: number }) => {
		x: number, y: number, z: number,
		start: () => void, stop: () => void,
		addEventListener: (type: string, fn: (ev: Event) => void) => void,
		removeEventListener: (type: string, fn: (ev: Event) => void) => void,
	})} */ globalThis.GravitySensor
	if (typeof Ctor !== 'function') return null
	if (!await ensureAccelerometerPermission()) return null
	try {
		const sensor = new Ctor({ frequency: FREQUENCY })
		/**
		 *
		 */
		const onReading = () => {
			const v = xyz(sensor)
			if (v) onSample(v[0], v[1], v[2])
		}
		sensor.addEventListener('reading', onReading)
		sensor.start()
		return () => {
			sensor.removeEventListener('reading', onReading)
			try {
				sensor.stop()
			}
			catch { /* already stopped */ }
		}
	}
	catch {
		return null
	}
}

/**
 * DeviceMotionEvent.accelerationIncludingGravity。
 * iOS（有 requestPermission）与 Android/W3C 的 y 符号相反，在此对齐到加速度计约定。
 * @param {(ax: number, ay: number, az: number) => void} onSample 回调
 * @returns {Promise<(() => void) | null>} stop；不可用则 null
 */
const startDeviceMotion = async (onSample) => {
	if (!globalThis.DeviceMotionEvent) return null
	if (!await ensureDeviceMotionPermission()) return null
	const iosAxes = typeof /** @type {{ requestPermission?: unknown }} */ globalThis.DeviceMotionEvent.requestPermission === 'function'
	/**
	 * @param {DeviceMotionEvent} event 运动事件
	 * @returns {void}
	 */
	const onMotion = (event) => {
		const v = xyz(event.accelerationIncludingGravity)
		if (!v) return
		// iOS: negate x/y to match Android / GravitySensor accelerometer frame
		onSample(iosAxes ? -v[0] : v[0], iosAxes ? -v[1] : v[1], v[2])
	}
	globalThis.addEventListener('devicemotion', onMotion)
	return () => globalThis.removeEventListener('devicemotion', onMotion)
}

/**
 * @param {(ax: number, ay: number, az: number) => void} onSample 样本回调
 * @returns {() => void} stop
 */
export const start = (onSample) => {
	/** @type {{ stop: (() => void) | null, dead: boolean }} */
	const ctl = { stop: null, dead: false }
	void (async () => {
		const stopGs = await startGravitySensor(onSample)
		if (ctl.dead) {
			stopGs?.()
			return
		}
		if (stopGs) {
			ctl.stop = stopGs
			return
		}
		const stopDm = await startDeviceMotion(onSample)
		if (ctl.dead) {
			stopDm?.()
			return
		}
		ctl.stop = stopDm
	})()
	return () => {
		ctl.dead = true
		ctl.stop?.()
		ctl.stop = null
	}
}
