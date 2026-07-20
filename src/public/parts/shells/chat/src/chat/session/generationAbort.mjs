/**
 * 【文件】generationAbort.mjs — 角色生成任务的 AbortSignal 生命周期
 * 【职责】createGenerationStream 为 GetReply 提供可中止 signal；按 messageId/dagEventId 或整群 abort。
 * 【原理】generationKey（UUID）关联 groupId 与 trackIds（messageId + dagEventId）；idToGenerationKey 双向索引；abort 时 AbortError 供 executeGeneration 区分用户取消与真实错误。
 * 【数据结构】activeGenerations、idToGenerationKey 两个 Map。
 * 【关联】triggerReply、wsLifecycle.handleClientWsControlFrame、messages.deleteMessage。
 */
/** @type {Map<string, { groupId: string, controller: AbortController, trackIds: Set<string> }>} */
const activeGenerations = new Map()

/** @type {Map<string, string>} messageId / dagEventId → generation key */
const idToGenerationKey = new Map()

/**
 * @param {string} groupId 群 ID
 * @param {string} messageId 占位条目 UUID
 * @param {string | null | undefined} dagEventId DAG 占位 message 事件 id
 * @returns {{ signal: AbortSignal, done: () => void, abort: (reason?: string) => void }} 流控制句柄
 */
export function createGenerationStream(groupId, messageId, dagEventId = null) {
	const controller = new AbortController()
	const generationKey = crypto.randomUUID()
	const trackIds = new Set([messageId, dagEventId].filter(Boolean).map(String))
	activeGenerations.set(generationKey, { groupId, controller, trackIds })
	for (const id of trackIds) idToGenerationKey.set(id, generationKey)

	/**
	 * 从活跃生成表与 id 索引中移除本流对应的 trackIds。
	 * @returns {void}
	 */
	const release = () => {
		const entry = activeGenerations.get(generationKey)
		if (!entry) return
		for (const id of entry.trackIds) idToGenerationKey.delete(id)
		activeGenerations.delete(generationKey)
	}

	return {
		signal: controller.signal,
		done: release,
		/** @param {string} [reason] 中断原因 */
		abort(reason = 'User Aborted') {
			if (controller.signal.aborted) return
			const error = new Error(reason)
			error.name = 'AbortError'
			controller.abort(error)
			release()
		},
	}
}

/** @param {string} messageId 流式消息 UUID 或 DAG event id */
export function abortGenerationByMessageId(messageId) {
	const id = String(messageId || '').trim()
	if (!id) return
	const generationKey = idToGenerationKey.get(id)
	if (!generationKey) return
	const entry = activeGenerations.get(generationKey)
	if (!entry || entry.controller.signal.aborted) return
	const error = new Error('User Aborted')
	error.name = 'AbortError'
	entry.controller.abort(error)
	for (const trackId of entry.trackIds) idToGenerationKey.delete(trackId)
	activeGenerations.delete(generationKey)
}

/** @param {string} groupId 群 ID */
export function abortAllGenerations(groupId) {
	for (const [generationKey, entry] of activeGenerations) {
		if (entry.groupId !== groupId || entry.controller.signal.aborted) continue
		const error = new Error('User Aborted')
		error.name = 'AbortError'
		entry.controller.abort(error)
		for (const trackId of entry.trackIds) idToGenerationKey.delete(trackId)
		activeGenerations.delete(generationKey)
	}
}
