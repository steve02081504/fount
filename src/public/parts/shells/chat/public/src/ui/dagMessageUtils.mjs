import { renderTemplate } from '../../../../../../pages/scripts/template.mjs'
import { geti18n, setLocalizeLogic } from '../../../../../../scripts/i18n.mjs'

/**
 * 将字符串中的 HTML 特殊字符转义为实体。
 * @param {string} s 原始文本
 * @returns {string} 可安全插入 innerHTML 邻域的文本
 */
function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/**
 * 由发送者标识生成稳定头像底色（24 位 RGB）。
 * @param {string} name 发送者名或公钥摘要
 * @returns {string} `#RRGGBB`
 */
function senderColor(name) {
	let h = 0
	for (let i = 0; i < name.length; i++)
		h = (h * 31 + name.charCodeAt(i)) & 0xFFFFFF
	return `#${(h & 0xFFFFFF).toString(16).padStart(6, '0')}`
}

/**
 * 将 DAG 行中的 `message_edit` / `message_delete` 折叠进主消息气泡展示（仍保留事件顺序外的语义）。
 * @param {object[]} messages 频道原始事件行数组
 * @returns {object[]} 合并后用于 UI 展示的消息行
 */
function mergeChannelMessagesForDisplay(messages) {
	/**
	 * message_feedback 仅作为本机本地交互反馈展示，不参与联邦来源消息的聚合。
	 * @param {object} row DAG 事件行
	 * @returns {boolean} 是否为本机反馈事件
	 */
	const isLocalOnlyFeedbackEvent = (row) => row?.type === 'message_feedback' && row?.sender === 'local'
	const edits = new Map()
	const deleted = new Set()
	const lastFeedbackIdx = new Map()
	const n = messages.length
	for (let i = 0; i < n; i++) {
		const row = messages[i]
		const entryId = row.content?.chatLogEntryId
		if (!entryId) continue
		if (row.type === 'message_edit')
			edits.set(entryId, row.content)
		if (row.type === 'message_delete')
			deleted.add(entryId)
		if (isLocalOnlyFeedbackEvent(row))
			lastFeedbackIdx.set(entryId, i)
	}
	const out = []
	for (let i = 0; i < n; i++) {
		const row = messages[i]
		if (row.type === 'message_edit' || row.type === 'message_delete')
			continue
		if (row.type === 'message_feedback') {
			if (!isLocalOnlyFeedbackEvent(row)) continue
			const entryId = row.content?.chatLogEntryId
			if (!entryId || deleted.has(entryId)) continue
			if (lastFeedbackIdx.get(entryId) !== i) continue
			out.push(row)
			continue
		}
		if (row.type === 'message') {
			const entryId = row.content?.chatLogEntryId
			if (entryId && deleted.has(entryId))
				continue
			if (entryId && edits.has(entryId)) {
				const editSnapshot = edits.get(entryId)
				out.push({
					...row,
					content: {
						...row.content,
						text: editSnapshot.text,
						...editSnapshot.fileCount != null ? { fileCount: editSnapshot.fileCount } : {},
					},
				})
				continue
			}
		}
		out.push(row)
	}
	return out
}

/**
 * 稳定比较两条 DAG 边（主路径：时间戳升序，其次 eventId 字典序）。
 * @param {object} a 消息行
 * @param {object} b 消息行
 * @returns {number} sort 比较值
 */
function compareDagSiblingOrder(a, b) {
	const ta = Number(a?.timestamp)
	const tb = Number(b?.timestamp)
	const na = Number.isFinite(ta) ? ta : 0
	const nb = Number.isFinite(tb) ? tb : 0
	if (na !== nb) return na - nb
	const ida = String(a?.eventId ?? '')
	const idb = String(b?.eventId ?? '')
	return ida.localeCompare(idb, 'und')
}

/**
 * 基于 prevMessageEventId 链式指针和 activeBranches 选择，从所有消息中构建当前显示路径。
 * 在 mergeChannelMessagesForDisplay 的结果之上运行（edit/delete 已折叠完毕）。
 * 主路径：自「无 prev 的根」中按 (timestamp, eventId) 取**最后**一个根为链起点（与既有单线程时间线一致），
 * 沿链在分叉处取 activeBranches 选中项；未选时取同序下第一个子边（确定性默认）。
 * @param {object[]} mergedMessages mergeChannelMessagesForDisplay 返回的消息数组
 * @param {Map<string, string>} activeBranches Key=prevMessageEventId, Value=选中的 eventId
 * @returns {{ messages: object[], branchInfo: Map<string, { alternatives: object[], selectedIdx: number, branchKey: string }> }} 当前分支路径上的消息列表及各分支点信息
 */
function buildDisplayChain(mergedMessages, activeBranches) {
	const hasPrevPointer = mergedMessages.some(m => m.content?.prevMessageEventId)
	if (!hasPrevPointer)
		return { messages: mergedMessages, branchInfo: new Map() }

	const byEventId = new Map()
	const childrenOf = new Map()
	for (const m of mergedMessages) {
		if (m.eventId) byEventId.set(m.eventId, m)
		const prev = m.content?.prevMessageEventId
		if (prev) {
			if (!childrenOf.has(prev)) childrenOf.set(prev, [])
			childrenOf.get(prev).push(m)
		}
	}
	for (const list of childrenOf.values())
		list.sort(compareDagSiblingOrder)

	const roots = mergedMessages.filter(m => !m.content?.prevMessageEventId).sort(compareDagSiblingOrder)
	const result = [...roots]
	const branchInfo = new Map()

	let cursor = roots[roots.length - 1]?.eventId ?? null

	const visited = new Set()
	while (cursor !== null && !visited.has(cursor)) {
		visited.add(cursor)
		const children = childrenOf.get(cursor)
		if (!children?.length) break

		if (children.length === 1) {
			result.push(children[0])
			cursor = children[0].eventId
		}
		else {
			const activeId = activeBranches.get(cursor)
			const selected = children.find(m => m.eventId === activeId) ?? children[0]
			const selectedIdx = children.indexOf(selected)
			branchInfo.set(selected.eventId, {
				alternatives: children,
				selectedIdx,
				branchKey: cursor,
			})
			result.push(selected)
			cursor = selected.eventId
		}
	}

	return { messages: result, branchInfo }
}

/**
 * 按时间线重放 pin/unpin，得到当前仍置顶的 targetEventId 列表（最近置顶在前）。
 * @param {object[]} messages 频道原始消息行（未 merge）
 * @returns {string[]} 仍置顶的消息事件 ID，最近置顶在前
 */
function orderedActivePinTargets(messages) {
	const active = new Set()
	for (const ev of messages) {
		if (ev.type === 'pin_message' && ev.content?.targetId)
			active.add(String(ev.content.targetId))
		if (ev.type === 'unpin_message' && ev.content?.targetId)
			active.delete(String(ev.content.targetId))
	}
	const recentFirst = []
	for (let i = messages.length - 1; i >= 0; i--) {
		const ev = messages[i]
		if (ev.type === 'pin_message' && ev.content?.targetId) {
			const t = String(ev.content.targetId)
			if (active.has(t) && !recentFirst.includes(t))
				recentFirst.push(t)
		}
	}
	return recentFirst
}

/**
 * 按 `parentChannelId` 将频道展平为深度优先列表（用于侧栏树形缩进）。
 * @param {Record<string, { name?: string, type?: string, parentChannelId?: string }>} channels 频道 ID 到元数据的映射
 * @returns {{ id: string, meta: object, depth: number }[]} 带深度的扁平列表
 */
function flattenChannelTree(channels) {
	if (!channels || typeof channels !== 'object') return []
	const byParent = new Map()
	for (const [id, meta] of Object.entries(channels)) {
		const p = meta.parentChannelId !== undefined && meta.parentChannelId !== null && meta.parentChannelId !== ''
			? String(meta.parentChannelId)
			: ''
		if (!byParent.has(p)) byParent.set(p, [])
		byParent.get(p).push({ id, meta })
	}
	for (const list of byParent.values())
		list.sort((a, b) => (a.meta.name || a.id).localeCompare(b.meta.name || b.id, 'und'))
	/** @type {{ id: string, meta: object, depth: number }[]} */
	const out = []
	/**
	 * 深度优先遍历子频道树。
	 * @param {string} pid 父频道 ID（根为空字符串）
	 * @param {number} depth 当前深度（根为 0）
	 * @returns {void}
	 */
	function walk(pid, depth) {
		for (const { id, meta } of byParent.get(pid) || []) {
			out.push({ id, meta, depth })
			walk(id, depth + 1)
		}
	}
	walk('', 0)
	return out
}

/**
 * 置顶条里展示的纯文本预览（不含 HTML）。
 * @param {object | undefined} ev DAG 事件行或消息对象
 * @returns {string} 截断后的预览文本
 */
function plainPreviewFromLine(ev) {
	if (!ev) return ''
	const content = ev.content
	if (typeof content === 'string')
		return content.length > 56 ? `${content.slice(0, 56)}…` : content
	if (content && typeof content === 'object') {
		if (content.text != null && String(content.text).trim())
			return String(content.text).length > 56 ? `${String(content.text).slice(0, 56)}…` : String(content.text)
		const fileCount = Number(content.fileCount) || 0
		if (fileCount > 0)
			return geti18n('chat.group.attachmentsHint', { n: fileCount })
		if (content.choice != null)
			return String(content.choice).slice(0, 48)
	}
	if (ev.type === 'message_feedback') {
		const feedbackType = content?.feedbackType
		const tagText = feedbackType === 'up'
			? geti18n('chat.group.feedbackUp')
			: feedbackType === 'down'
				? geti18n('chat.group.feedbackDown')
				: ''
		const notePreview = content?.feedbackContent ? String(content.feedbackContent).slice(0, 36) : ''
		if (tagText && notePreview)
			return geti18n('chat.group.feedbackPreviewTaggedNote', { tag: tagText, note: notePreview }).slice(0, 56)
		if (tagText)
			return tagText.slice(0, 56)
		if (notePreview)
			return notePreview.slice(0, 56)
		return (ev.type || 'msg').slice(0, 24)
	}
	return (ev.type || 'msg').slice(0, 24)
}

/**
 * 从消息列表中重放计票，统计各选项得票数。
 * @param {object[]} messages 频道全部事件行
 * @param {string} voteMsgEventId 投票发起消息的 eventId
 * @returns {Map<string, number>} 选项文案到票数的映射
 */
function tallyVotes(messages, voteMsgEventId) {
	/** @type {Map<string, string>} pubKeyHash/sender -> choice */
	const byVoter = new Map()
	for (const m of messages)
		if (m.type === 'vote_cast' && m.content?.ballotId === voteMsgEventId && m.content?.choice != null)
			byVoter.set(m.sender || m.content.voter || m.eventId, String(m.content.choice))

	/** @type {Map<string, number>} choice -> count */
	const counts = new Map()
	for (const choice of byVoter.values())
		counts.set(choice, (counts.get(choice) || 0) + 1)
	return counts
}

/**
 * 从消息列表中重放 reaction_add / reaction_remove，统计各消息的表情回应。
 * @param {object[]} messages 频道全部事件行
 * @param {string} targetEventId 目标消息的 eventId
 * @returns {Map<string, { count: number, byMe: boolean }>} emoji → {count, byMe}
 */
function tallyReactions(messages, targetEventId) {
	// sender → emoji → 是否已添加（add/remove 相互抵消）
	/** @type {Map<string, Map<string, boolean>>} */
	const byVoter = new Map()
	const target = String(targetEventId)
	for (const m of messages) {
		if (m.type !== 'reaction_add' && m.type !== 'reaction_remove')
			continue
		const tid = m.content?.targetEventId ?? m.content?.targetId
		if (String(tid) !== target) continue
		const sender = m.sender || m.content?.sender || m.eventId
		const emoji = m.content?.emoji
		if (!emoji) continue
		if (!byVoter.has(sender)) byVoter.set(sender, new Map())
		byVoter.get(sender).set(emoji, m.type === 'reaction_add')
	}
	// emoji → {count, byMe}
	const result = new Map()
	const myId = 'local' // 本节点发出的 reaction sender 标识
	for (const [sender, emojis] of byVoter) 
		for (const [emoji, active] of emojis) {
			if (!active) continue
			const prev = result.get(emoji) || { count: 0, byMe: false }
			result.set(emoji, {
				count: prev.count + 1,
				byMe: prev.byMe || sender === myId,
			})
		}
	
	return result
}

/**
 * 将单条 DAG 行格式化为气泡内根元素（纯文本用 textContent；投票块用模板 DOM）。
 * @param {object} line 事件行
 * @param {object[]} allMessages 同频道全部行（用于投票计票等上下文）
 * @returns {Promise<HTMLElement>} 单根元素或可包裹为单根的节点
 */
async function formatGroupMessageLine(line, allMessages) {
	if (line.type === 'file_upload') {
		const el = document.createElement('span')
		setLocalizeLogic(el, () => {
			const name = String(line.content?.name || geti18n('chat.group.unknownFile'))
			const mime = String(line.content?.mimeType || '')
			el.replaceChildren()
			const wrap = document.createElement('span')
			wrap.className = 'inline-flex items-center gap-1'
			const img = document.createElement('img')
			img.className = 'w-4 h-4 inline shrink-0'
			img.alt = ''
			if (mime.startsWith('image/')) img.src = 'https://api.iconify.design/line-md/image.svg'
			else if (mime.startsWith('video/')) img.src = 'https://api.iconify.design/line-md/movie-play.svg'
			else if (mime.startsWith('audio/')) img.src = 'https://api.iconify.design/line-md/volume-high.svg'
			else img.src = 'https://api.iconify.design/line-md/attachment.svg'
			const nameSpan = document.createElement('span')
			nameSpan.textContent = name
			wrap.appendChild(img)
			wrap.appendChild(nameSpan)
			el.appendChild(wrap)
		})
		return el
	}
	if (line.type === 'vote_cast') {
		const el = document.createElement('span')
		setLocalizeLogic(el, () => {
			const choice = line.content?.choice != null ? String(line.content.choice) : ''
			el.textContent = geti18n('chat.group.voteCastLineTagged', { choice })
		})
		return el
	}
	if (line.content?.kind === 'vote') {
		const voteQuestionEscaped = escapeHtml(String(line.content.question || ''))
		const opts = line.content.options || []
		const counts = allMessages ? tallyVotes(allMessages, line.eventId) : new Map()
		const total = [...counts.values()].reduce((a, b) => a + b, 0)
		const voteHeading = geti18n('chat.group.voteBlockHeadingTagged', { question: voteQuestionEscaped })
		const node = await renderTemplate('vote_block', {
			voteHeading,
			total,
			geti18n,
		})
		const root = node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
			? (() => {
				const wrap = document.createElement('div')
				wrap.appendChild(node)
				return wrap
			})()
			: /** @type {HTMLElement} */ node
		const optsRoot = root.querySelector('[data-vote-options]')
		const deadlineRoot = root.querySelector('[data-vote-deadline]')
		if (optsRoot)
			for (const optionLabel of opts) {
				const voteCount = counts.get(String(optionLabel)) || 0
				const pct = total ? Math.round(voteCount * 100 / total) : 0
				optsRoot.appendChild(await renderTemplate('vote_option_row', {
					label: String(optionLabel),
					count: voteCount,
					pct,
					escapeHtml,
				}))
			}
		if (line.content.deadline && deadlineRoot) {
			const d = new Date(line.content.deadline)
			const past = d < new Date()
			const deadlineText = geti18n(past ? 'chat.group.voteDeadlineLineClosed' : 'chat.group.voteDeadlineLineOpen', { date: d.toLocaleString() })
			deadlineRoot.appendChild(await renderTemplate('vote_deadline_row', {
				deadlineText,
				escapeHtml,
			}))
		}
		return root
	}
	if (line.type === 'vote' || line.content?.ballotId) {
		const el = document.createElement('span')
		setLocalizeLogic(el, () => {
			const optionsJoined = (line.content?.options || []).map(optionLabel => String(optionLabel)).join(' / ')
			el.textContent = geti18n('chat.group.voteOptionsPreviewTagged', { options: optionsJoined })
		})
		return el
	}
	if (line.type === 'sticker' || line.content?.stickerBase64) {
		const el = document.createElement('span')
		setLocalizeLogic(el, () => {
			el.textContent = geti18n('chat.group.stickerPrefixLineTagged')
		})
		return el
	}
	if (line.type === 'pin_message') {
		const el = document.createElement('span')
		setLocalizeLogic(el, () => {
			el.textContent = geti18n('chat.group.pinMessageLine', { targetId: String(line.content?.targetId || '') })
		})
		return el
	}
	if (line.type === 'unpin_message') {
		const el = document.createElement('span')
		setLocalizeLogic(el, () => {
			el.textContent = geti18n('chat.group.unpinMessageLine', { targetId: String(line.content?.targetId || '') })
		})
		return el
	}
	if (line.type === 'message_feedback') {
		const el = document.createElement('span')
		setLocalizeLogic(el, () => {
			const feedbackType = line.content?.feedbackType
			const labelText = feedbackType === 'up'
				? geti18n('chat.group.feedbackUp')
				: feedbackType === 'down'
					? geti18n('chat.group.feedbackDown')
					: ''
			const feedbackNoteRaw = line.content?.feedbackContent
			const feedbackNoteTrimmed = feedbackNoteRaw != null && String(feedbackNoteRaw).trim()
				? String(feedbackNoteRaw).trim()
				: ''
			el.textContent = feedbackNoteTrimmed
				? geti18n('chat.group.feedbackDagLineWithNote', { label: labelText, note: feedbackNoteTrimmed })
				: geti18n('chat.group.feedbackDagLine', { label: labelText })
		})
		return el
	}
	if (line.type === 'message_delete') {
		const el = document.createElement('span')
		setLocalizeLogic(el, () => {
			el.textContent = geti18n('chat.group.messageDeletedBracket')
		})
		return el
	}
	if (line.type === 'message_edit') {
		const editText = line.content?.text
		if (editText != null) {
			const el = document.createElement('span')
			el.textContent = String(editText)
			return el
		}
	}
	if (line.type === 'message') {
		const raw = typeof line.content === 'string' ? line.content : line.content?.text
		const fileCount = Number(line.content?.fileCount) || 0
		const textEmpty = raw == null || !String(raw).trim()
		if (textEmpty && fileCount > 0) {
			const el = document.createElement('span')
			setLocalizeLogic(el, () => {
				el.textContent = geti18n('chat.group.attachmentsHint', { n: fileCount })
			})
			return el
		}
		if (!textEmpty && fileCount > 0) {
			const el = document.createElement('span')
			setLocalizeLogic(el, () => {
				const attachmentHint = geti18n('chat.group.attachmentsHint', { n: fileCount })
				el.textContent = geti18n('chat.group.messageWithAttachments', {
					text: String(raw),
					hint: attachmentHint,
				})
			})
			return el
		}
	}
	const el = document.createElement('span')
	setLocalizeLogic(el, () => {
		const text = typeof line.content === 'string' ? line.content : line.content?.text || JSON.stringify(line.content || {})
		el.textContent = text
	})
	return el
}

/**
 *
 */
export {
	escapeHtml,
	senderColor,
	mergeChannelMessagesForDisplay,
	buildDisplayChain,
	orderedActivePinTargets,
	flattenChannelTree,
	plainPreviewFromLine,
	tallyVotes,
	tallyReactions,
	formatGroupMessageLine,
}
