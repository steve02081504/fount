/**
 * 按运行环境选择重力采集实现。
 * - `globalThis.document` → 浏览器（GravitySensor / DeviceMotionEvent）
 * - Termux → termux-sensor
 * - 其余 → no-op
 */

/**
 * @returns {Promise<typeof import('./none.mjs')>} 采集模块
 */
export const loadAcquire = async () => {
	if (globalThis.document)
		return import('./browser.mjs')
	const { in_termux } = await import('../../../src/scripts/env.mjs')
	if (in_termux) return import('./termux.mjs')
	return import('./none.mjs')
}
