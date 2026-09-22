/**
 * code shell 会话条目扩展白名单：仅透传前端渲染所需字段（历史默认清空，避免把内部结构写进会话）。
 */

/**
 * 挑选需随会话落盘的前端可见扩展字段（子代理运行定位、结构化工具卡、统一异步任务）。
 * @param {object} extension - 条目扩展。
 * @returns {object} 白名单后的扩展。
 */
export function pickEntryExtension(extension) {
	if (!extension || typeof extension !== 'object') return {}
	/** @type {object} */
	const picked = {}
	if (extension.subAgent) picked.subAgent = extension.subAgent
	if (extension.subAgentCheck) picked.subAgentCheck = extension.subAgentCheck
	if (extension.asyncTask) picked.asyncTask = extension.asyncTask
	if (extension.asyncList) picked.asyncList = extension.asyncList
	if (extension.asyncAwait) picked.asyncAwait = extension.asyncAwait
	if (extension.error) picked.error = extension.error
	return picked
}
