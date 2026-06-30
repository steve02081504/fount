/**
 * 纯函数：从已加载的 reputation 文件体计算节点全局分（无 setting_loader 依赖）。
 * @param {object} repFile reputation.json 内容
 * @param {string} nodeId 64 hex 节点
 * @returns {number} 信誉分
 */
export function pickNodeScoreFromReputation(repFile, nodeId) {
	const row = repFile?.byNodeHash?.[nodeId]
	if (!row) return 0
	return Number(row.score ?? 0)
}
