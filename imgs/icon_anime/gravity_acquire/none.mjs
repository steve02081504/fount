/**
 * 无设备传感器：采集 no-op。
 */

/**
 * @param {(ax: number, ay: number, az: number) => void} _onSample 样本回调（未使用）
 * @returns {() => void} stop
 */
export const start = (_onSample) => () => { /* no-op */ }
