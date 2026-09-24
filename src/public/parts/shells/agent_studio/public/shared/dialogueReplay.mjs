/**
 * 【文件】dialogueReplay.mjs — 从逐轮请求快照复原对话的纯函数
 * 【职责】把一次生成的逐轮请求（每轮可见消息）按消息 id 合并成一条对话事件流，并支持按轮次复播。
 * 【原理】相邻请求通常重复携带历史消息：首次出现的 id 记为 insert；同一 id 内容变化记为 update（即编辑）并保留其发生的轮次；
 *   内容未变则不重复记录。末轮角色回复无处可寻（没有下一次请求），由调用方作为最终事件补入。
 *   复播到第 N 轮时按轮次顺序应用事件，因此同一条消息会随轮次推进呈现当时的内容。
 * 【关联】request_record.mjs 生成事件并落盘；generation_history.mjs 读取；前端会话视图复播。
 */

/**
 * 从请求消息中提取用于展示的字段。
 * @param {object} message 消息
 * @returns {{ id: string, role: string, name: string, uid: string, content: string }} 展示消息
 */
function pickMessage(message) {
	return {
		id: message.id,
		role: message.role ?? 'system',
		name: message.name ?? '',
		uid: message.uid ?? '',
		content: message.content ?? '',
	}
}

/**
 * 由逐轮请求快照与最终回复构建对话事件流。
 *
 * 最终回复是末轮请求的输出，与末轮同轮次（不新增幻影轮）；只有回复而无请求时占第 1 轮。
 * 轮次号必须与 `buildRoundUnits` 的口径一致，否则多代合并复播会整体错位。
 * @param {object[]} requests 逐轮请求快照（含 `index` 与 `messages`）
 * @param {{ response?: unknown, responseId?: string, responseName?: string, responseUid?: string }} [final] 最终角色回复
 * @returns {{ rounds: number, events: object[] }} 对话事件与总轮次
 */
export function buildDialogue(requests, final = {}) {
	const events = []
	/** 已出现消息 id → 当前内容 @type {Map<string, string>} */
	const latest = new Map()
	let round = 0
	for (const request of requests || []) {
		round = request.index ?? round + 1
		for (const message of request.messages || []) {
			if (!message?.id) continue
			const content = message.content ?? ''
			const previous = latest.get(message.id)
			if (previous === undefined) {
				latest.set(message.id, content)
				events.push({ round, op: 'insert', message: pickMessage(message) })
			}
			else if (previous !== content) {
				latest.set(message.id, content)
				events.push({ round, op: 'update', id: message.id, content })
			}
		}
	}
	if (final.response !== undefined) {
		round = Math.max(round, 1)
		events.push({
			round,
			op: 'insert',
			message: {
				id: final.responseId ?? `final:${round}`,
				role: 'char',
				name: final.responseName ?? '',
				uid: final.responseUid ?? 'char',
				content: String(final.response),
			},
		})
	}
	return { rounds: round, events }
}

/**
 * 复播对话事件到指定轮次。
 * @param {object[]} events 对话事件
 * @param {{ upToRound?: number }} [options] 选项：`upToRound` 缺省为全部轮次
 * @returns {object[]} 该轮次下的消息列表（按首次出现顺序）
 */
export function replayDialogue(events, { upToRound } = {}) {
	const order = []
	/** @type {Map<string, object>} */
	const byId = new Map()
	for (const event of events || []) {
		if (upToRound != null && (event.round ?? 0) > upToRound) continue
		if (event.op === 'insert' && event.message?.id) {
			const copy = { ...event.message }
			if (!byId.has(copy.id)) order.push(copy.id)
			byId.set(copy.id, copy)
		}
		else if (event.op === 'update' && event.id) {
			const existing = byId.get(event.id)
			if (existing) existing.content = event.content
		}
	}
	return order.map(id => byId.get(id))
}
