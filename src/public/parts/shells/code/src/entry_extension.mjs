/**
 * code shell 会话条目扩展白名单：仅透传前端渲染字段、工具的 `executionTarget` 快照（供重载后按产出目标预读）与插件私有数据（历史默认清空，避免把内部结构写进会话）。
 */

/**
 * 挑选需随会话落盘的前端可见扩展字段（子代理运行定位、结构化工具卡、统一异步任务、工具执行目标、插件私有数据）。
 * `pluginData` 为插件自有的 JSON 可序列化命名空间：shell 整体透传该字段本身，不解释其内部键，
 * 并做 JSON 往返深拷贝以保证落盘内容可序列化。
 * @param {object} extension - 条目扩展。
 * @returns {object} 白名单后的扩展。
 */
export function pickEntryExtension(extension) {
	if (!extension || typeof extension !== 'object') return {}
	/** @type {object} */
	const picked = {}
	if (extension.subAgent) picked.subAgent = extension.subAgent
	if (extension.asyncTask) picked.asyncTask = extension.asyncTask
	if (extension.asyncList) picked.asyncList = extension.asyncList
	if (extension.asyncAwait) picked.asyncAwait = extension.asyncAwait
	if (extension.asyncInspect) picked.asyncInspect = extension.asyncInspect
	if (extension.error) picked.error = extension.error
	if (extension.toolCall) picked.toolCall = extension.toolCall
	if (extension.executionTarget) picked.executionTarget = extension.executionTarget
	if (extension.pluginData && typeof extension.pluginData === 'object' && !Array.isArray(extension.pluginData))
		picked.pluginData = JSON.parse(JSON.stringify(extension.pluginData))
	return picked
}
