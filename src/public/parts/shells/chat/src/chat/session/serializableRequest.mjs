/**
 * 【文件】serializableRequest.mjs — 跨节点 RPC 可序列化生成请求体
 * 【职责】buildSerializableRequest 打包 groupId/channelId/charname/replicaUsername/personaForOther/logWindow；isSerializableRequest 校验 RPC 首参是否合法。
 * 【原理】远端节点收到后据此字段本地调用 getChatRequest 再执行 GetReply，避免传输完整 chatReplyRequest；personaForOther 支持跨机代发人格上下文。
 * 【数据结构】{ groupId, channelId, charname, replicaUsername, personaForOther?, logWindow? } 纯 JSON。
 * 【关联】rpcInvoke、triggerReply（跨机分支）、session.mjs tryInvokeLocalCharRpc。
 */
/**
 * 跨节点 RPC 用的可序列化生成请求（执行端本地 `getChatRequest` 重建）。
 * @param {object} fields 字段
 * @returns {object} 可 JSON 序列化的请求体
 */
export function buildSerializableRequest(fields) {
	const {
		groupId,
		channelId,
		charname,
		replicaUsername,
		personaForOther,
		logWindow,
	} = fields
	return {
		groupId,
		channelId: channelId || null,
		charname,
		replicaUsername,
		personaForOther: personaForOther || undefined,
		logWindow: logWindow || undefined,
	}
}

/**
 * @param {unknown} value 首个 RPC 参数
 * @returns {boolean} 是否为合法 RPC 请求对象
 */
export function isSerializableRequest(value) {
	return !!(value?.groupId && value?.charname)
}
