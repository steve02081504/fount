/**
 * 纯函数：从已加载的 reputation 文件体计算节点分（无 setting_loader 依赖）。
 * @param {object} repFile reputation.json 内容
 * @param {string} nodeId 64 hex 节点
 * @param {string} [groupId] 群 ID（可选 scope）
 * @returns {number} 信誉分
 */
export function pickNodeScoreFromReputation(repFile, nodeId, groupId = '') {
	const row = repFile?.byNodeHash?.[nodeId]
	if (!row) return 0
	const gid = String(groupId || '').trim()
	if (gid && row.scopes?.[gid] != null) return Number(row.scopes[gid])
	return Number(row.score ?? 0)
}
