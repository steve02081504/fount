/**
 * 【文件】state.mjs — context-compress 插件的内存状态
 * 【职责】保存插件配置（压缩阈值）。
 * 【原理】插件配置为纯内存对象，进程重启即重置为默认值；`parts_loader` 加载后经 `interfaces.config.SetData`
 *   注入持久化的 parts_config，用户修改经 config shell 落盘。阈值仅用于提示何时建议压缩，不参与强制逻辑。
 * 【数据结构】config = { threshold: number }。
 * 【关联】main.mjs（config 接口）、prompt.mjs（阈值）、handler.mjs。
 */

/** 默认压缩阈值：估算 token 占用率达到该比例即视为接近上限。 */
export const DEFAULT_THRESHOLD = 0.729

/** 插件配置（纯内存，随进程生命周期）。 @type {{ threshold: number }} */
const config = { threshold: DEFAULT_THRESHOLD }

/**
 * 归一化阈值：仅接受 (0, 1] 内的有限数值，否则回退默认值。
 * @param {unknown} value 候选阈值
 * @returns {number} 可用阈值
 */
function normalizeThreshold(value) {
	const threshold = Number(value)
	return Number.isFinite(threshold) && threshold > 0 && threshold <= 1 ? threshold : DEFAULT_THRESHOLD
}

/**
 * 读取当前插件配置快照。
 * @returns {{ threshold: number }} 配置副本
 */
export function getConfig() {
	return { threshold: config.threshold }
}

/**
 * 写入插件配置（来自 parts_loader 或 config shell）。
 * @param {{ threshold?: unknown } | null | undefined} data 配置数据
 * @returns {void}
 */
export function setConfig(data) {
	config.threshold = normalizeThreshold(data?.threshold)
}

/**
 * 读取当前压缩阈值。
 * @returns {number} 阈值
 */
export function getThreshold() {
	return config.threshold
}
