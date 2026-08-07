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
	const permissions = globalThis.navigator?.permissions
	if (!permissions?.query) return true
	try {
		const status = await permissions.query({
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
	const deviceMotionEvent = globalThis.DeviceMotionEvent
	const requestPermission = deviceMotionEvent && /** @type {{ requestPermission?: () => Promise<string> }} */ deviceMotionEvent.requestPermission
	if (typeof requestPermission !== 'function') return true
	try {
		return await requestPermission.call(deviceMotionEvent) === 'granted'
	}
	catch {
		return false
	}
}

/**
 * 从三轴对象取有限数值。
 * @param {{ x?: number | null, y?: number | null, z?: number | null } | null | undefined} vector 矢量
 * @returns {[number, number, number] | null} 三轴
 */
const xyz = (vector) => {
	if (!vector) return null
	const x = +vector.x, y = +vector.y, z = +vector.z
	if (![x, y, z].every(Number.isFinite)) return null
	return [x, y, z]
}

/**
 * GravitySensor（Chromium）。
 * 等首次 reading / error / abort 再决定成败，避免 start 成功但无读数时挡住 DeviceMotion 回落。
 * @param {(ax: number, ay: number, az: number) => void} onSample 回调
 * @param {AbortSignal} [signal] 会话停止时中止等待
 * @returns {Promise<(() => void) | null>} stop；不可用则 null
 */
const startGravitySensor = async (onSample, signal) => {
	const GravitySensorCtor = /** @type {undefined | (new (opts?: { frequency?: number }) => {
		x: number, y: number, z: number,
		start: () => void, stop: () => void,
		addEventListener: (type: string, fn: (ev: Event) => void) => void,
		removeEventListener: (type: string, fn: (ev: Event) => void) => void,
	})} */ globalThis.GravitySensor
	if (typeof GravitySensorCtor !== 'function') return null
	if (signal?.aborted) return null
	if (!await ensureAccelerometerPermission()) return null
	if (signal?.aborted) return null
	try {
		const sensor = new GravitySensorCtor({ frequency: FREQUENCY })
		return await new Promise((resolve) => {
			let settled = false
			/**
			 * 卸监听并停传感器。
			 * @returns {void}
			 */
			const detach = () => {
				signal?.removeEventListener('abort', onAbort)
				sensor.removeEventListener('reading', onReading)
				sensor.removeEventListener('error', onError)
				try {
					sensor.stop()
				}
				catch { /* already stopped */ }
			}
			/**
			 * 会话 abort：清理并 resolve null。
			 * @returns {void}
			 */
			const onAbort = () => {
				if (settled) return
				settled = true
				detach()
				resolve(null)
			}
			/**
			 * 持续 reading：推送样本；首次成功时 resolve 清理函数。
			 * @returns {void}
			 */
			const onReading = () => {
				const axes = xyz(sensor)
				if (axes) onSample(axes[0], axes[1], axes[2])
				if (settled) return
				settled = true
				signal?.removeEventListener('abort', onAbort)
				resolve(() => {
					sensor.removeEventListener('reading', onReading)
					sensor.removeEventListener('error', onError)
					try {
						sensor.stop()
					}
					catch { /* already stopped */ }
				})
			}
			/**
			 * 启动失败：卸监听并 resolve null，交给 DeviceMotion 回落。
			 * @returns {void}
			 */
			const onError = () => {
				if (settled) return
				settled = true
				detach()
				resolve(null)
			}
			sensor.addEventListener('reading', onReading)
			sensor.addEventListener('error', onError)
			signal?.addEventListener('abort', onAbort, { once: true })
			if (signal?.aborted) {
				onAbort()
				return
			}
			try {
				sensor.start()
			}
			catch {
				onError()
			}
		})
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
		const axes = xyz(event.accelerationIncludingGravity)
		if (!axes) return
		// iOS: negate x/y to match Android / GravitySensor accelerometer frame
		onSample(iosAxes ? -axes[0] : axes[0], iosAxes ? -axes[1] : axes[1], axes[2])
	}
	globalThis.addEventListener('devicemotion', onMotion)
	return () => globalThis.removeEventListener('devicemotion', onMotion)
}

/**
 * @param {(ax: number, ay: number, az: number) => void} onSample 样本回调
 * @returns {() => void} stop
 */
export const start = (onSample) => {
	/** @type {{ stop: (() => void) | null }} */
	const control = { stop: null }
	const abortController = new AbortController()
	void (async () => {
		const stopGravitySensor = await startGravitySensor(onSample, abortController.signal)
		if (abortController.signal.aborted) {
			stopGravitySensor?.()
			return
		}
		if (stopGravitySensor) {
			control.stop = stopGravitySensor
			return
		}
		const stopDeviceMotion = await startDeviceMotion(onSample)
		if (abortController.signal.aborted) {
			stopDeviceMotion?.()
			return
		}
		control.stop = stopDeviceMotion
	})()
	return () => {
		abortController.abort()
		control.stop?.()
		control.stop = null
	}
}
