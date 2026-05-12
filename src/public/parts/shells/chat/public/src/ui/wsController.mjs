import * as Sentry from 'https://esm.sh/@sentry/browser'

import { geti18n, setLocalizeLogic } from '../../../../../../scripts/i18n.mjs'

import { StreamRenderer } from './StreamRenderer.mjs'

/** 写入频道消息流、会出现在 /messages 中的事件类型（与 dag.mjs PERSIST_MESSAGE_TYPES 对齐） */
const PATCHABLE_CHANNEL_EVENT_TYPES = new Set([
	'message', 'message_edit', 'message_delete', 'message_feedback',
	'vote_cast', 'pin_message', 'unpin_message',
	'reaction_add', 'reaction_remove',
])

/**
 * 将 DAG 事件规范为与 channel 消息行一致的形状。
 * @param {object} ev DAG 事件
 * @param {string} channelId 当前频道 ID
 * @returns {object | null} 消息行；非本频道时为 null
 */
function rawLineFromDagEvent(ev, channelId) {
	if (!ev || typeof ev !== 'object') return null
	const ch = ev.channelId || ev.content?.channelId || 'default'
	if (ch !== channelId) return null
	return {
		eventId: ev.id,
		type: ev.type,
		content: ev.content,
		sender: ev.sender,
		charId: ev.charId,
		timestamp: ev.timestamp,
		receivedAt: ev.received_at ?? ev.receivedAt,
	}
}

/**
 * 创建群组 WebSocket 消息处理器（onmessage 回调）。
 * @param {object} params 工厂参数集合
 * @param {string} params.groupId 群组 ID
 * @param {string} params.channelId 当前频道 ID
 * @param {string} params.wsClientId 本客户端 ID（用于过滤自己发出的打字广播）
 * @param {object} params.state 共享可变状态
 * @param {Function} params.scheduleMessagePatch 增量消息 patch 调度函数
 * @param {Map} params.memberAvatarCache 成员头像缓存
 * @param {Map} params.typingUsers 正在打字用户 Map
 * @param {number} params.TYPING_TIMEOUT 打字超时毫秒数
 * @param {Function} params.updateTypingDisplay 更新打字指示器显示
 * @param {Function} params.loadMessages 重新拉取消息列表
 * @param {Function} params.loadState 重新拉取群组状态
 * @param {Function} params.loadBookmarks 重新拉取书签
 * @param {Function} params.getGroupWs 获取当前 WebSocket 实例（如停止生成等 RPC）
 * @param {Function} params.shouldLoadChannel 判断频道是否应加载
 * @param {Function} params.handleGroupWebSocketRpc RPC 消息处理器
 * @param {Function} params.handleSessionEvent 会话层事件转发
 * @param {HTMLElement} params.msgBox 消息容器（流式渲染备用挂载点）
 * @returns {Function} groupWs.onmessage 处理器
 */
export function createWsMessageHandler({
	groupId,
	channelId,
	wsClientId,
	state,
	scheduleMessagePatch,
	memberAvatarCache,
	typingUsers,
	TYPING_TIMEOUT,
	updateTypingDisplay,
	loadMessages,
	loadState,
	loadBookmarks,
	getGroupWs,
	shouldLoadChannel,
	handleGroupWebSocketRpc,
	handleSessionEvent,
	msgBox,
}) {
	/**
	 * 群 WebSocket 消息：会话事件、打字、DAG、流式片段与 WebRTC 信令等。
	 * @param {MessageEvent} ev 浏览器 MessageEvent
	 * @returns {Promise<void>}
	 */
	return async function onmessage(ev) {
		try {
			const msg = JSON.parse(ev.data)
			if (await handleGroupWebSocketRpc(msg)) return
			if (msg.type === 'member_update' && msg.memberId && msg.avatar) {
				memberAvatarCache.set(msg.memberId, msg.avatar)
				void state.msgVirtualList?.refresh?.()
			}
			// 将 session 层事件（message_added、stream_update 等）转发给 websocket.mjs 处理
			handleSessionEvent(msg)
			if ((msg.type === 'typing' || msg.type === 'group_typing') && msg.channelId === channelId) {
				if (msg.clientId === wsClientId) return
				const sender = msg.sender || '?'
				clearTimeout(typingUsers.get(sender))
				typingUsers.set(sender, setTimeout(() => {
					typingUsers.delete(sender)
					updateTypingDisplay()
				}, TYPING_TIMEOUT))
				updateTypingDisplay()
			}
			if (msg.type === 'channel_message' && msg.channelId === channelId && shouldLoadChannel(channelId)) 
				if (msg.message)
					scheduleMessagePatch(msg.message)
				else
					void loadMessages()
			
			if (msg.type === 'dag_event') {
				if (msg.event?.id)
					sessionStorage.setItem(`group:lastSyncedEvent:${groupId}`, msg.event.id)
				if (msg.event && PATCHABLE_CHANNEL_EVENT_TYPES.has(msg.event.type)) {
					const line = rawLineFromDagEvent(msg.event, channelId)
					if (line) scheduleMessagePatch(line)
				}
				loadState()
				loadBookmarks()
			}
			if (msg.type === 'group_stream_start' && msg.channelId === channelId) {
				const sid = msg.pendingStreamId || null
				if (state.volatileStreamEl) state.volatileStreamEl.remove()
				if (state.streamRenderer) {
					state.streamRenderer.cancel()
					state.streamRenderer = null
				}
				if (sid) state.volatileStreamReorderState.delete(sid)
				state.volatileStreamId = sid
				state.volatileStreamEl = document.createElement('div')
				state.volatileStreamEl.className = 'chat chat-start py-1'
				const head = document.createElement('div')
				head.className = 'chat-header flex flex-wrap items-center gap-2 text-xs opacity-70'
				const headLabel = document.createElement('span')
				headLabel.className = 'min-w-0 truncate'
				setLocalizeLogic(headLabel, () => {
					headLabel.textContent = msg.charId ? `@${msg.charId}` : geti18n('chat.group.aiStreaming')
				})
				head.appendChild(headLabel)
				if (sid) {
					const stopBtn = document.createElement('button')
					stopBtn.type = 'button'
					stopBtn.className = 'btn btn-xs btn-error btn-outline gap-1 ml-auto shrink-0 inline-flex items-center'
					const stopIcon = document.createElement('img')
					stopIcon.src = 'https://api.iconify.design/mdi/stop.svg'
					stopIcon.className = 'w-4 h-4 shrink-0'
					stopIcon.alt = ''
					const stopLabel = document.createElement('span')
					stopBtn.append(stopIcon, stopLabel)
					setLocalizeLogic(stopLabel, () => {
						stopLabel.textContent = geti18n('chat.group.stopGenerating')
					})
					stopBtn.addEventListener('click', () => {
						getGroupWs()?.send(JSON.stringify({
							type: 'stop_generation',
							payload: { messageId: sid },
						}))
					})
					head.appendChild(stopBtn)
				}
				const body = document.createElement('div')
				body.className = 'chat-bubble whitespace-pre-wrap break-words'
				body.dataset.volatileBody = '1'
				state.volatileStreamEl.appendChild(head)
				state.volatileStreamEl.appendChild(body)
				;(state.msgScrollContainer ?? msgBox).appendChild(state.volatileStreamEl)
				const skeletonEl = document.createElement('div')
				skeletonEl.className = 'flex flex-col gap-2 py-2'
				skeletonEl.dataset.streamSkeleton = '1'
				for (const w of ['w-40', 'w-56', 'w-32']) {
					const bar = document.createElement('div')
					bar.className = `skeleton h-3 rounded ${w}`
					skeletonEl.appendChild(bar)
				}
				body.appendChild(skeletonEl)
				state.streamRenderer = new StreamRenderer(body)
				/** @returns {void} */
				state.streamRenderer.onFirstChunk = () => {
					skeletonEl.remove()
				}
				const sc = state.msgScrollContainer ?? msgBox
				sc.scrollTop = sc.scrollHeight
				if (sid)
					state.volatileStreamReorderState.set(sid, { expectedSeq: 1, chunks: new Map() })
			}
			if (msg.type === 'group_stream_chunk' && msg.channelId === channelId && msg.pendingStreamId === state.volatileStreamId) {
				const sid = msg.pendingStreamId
				const seq = Number(msg.chunkSeq ?? 0)
				const st = state.volatileStreamReorderState.get(sid)
				const bodyEl = state.volatileStreamEl?.querySelector('[data-volatile-body]')
				if (st && bodyEl && typeof msg.text === 'string') {
					st.chunks.set(seq, msg.text)
					// VOLATILE 无联邦 NACK（§6.4）；缺口仅本地 UI 提示

					// 按序渲染
					while (st.chunks.has(st.expectedSeq)) {
						state.streamRenderer?.appendChunk(st.chunks.get(st.expectedSeq))
						st.chunks.delete(st.expectedSeq)
						st.expectedSeq++
					}
					// 展示缺口提示
					const hasGap = st.chunks.size > 0
					let gapEl = bodyEl.nextSibling
					if (hasGap) {
						if (!gapEl || gapEl.dataset?.streamGap !== '1') {
							gapEl = document.createElement('span')
							gapEl.dataset.streamGap = '1'
							gapEl.className = 'text-xs opacity-50 ml-1'
							gapEl.textContent = ' …'
							bodyEl.parentNode.insertBefore(gapEl, bodyEl.nextSibling)
						}
					}
					else
						if (gapEl?.dataset?.streamGap === '1') gapEl.remove()

					const sc2 = state.msgScrollContainer ?? msgBox
					sc2.scrollTop = sc2.scrollHeight
				}
			}
			if (msg.type === 'group_stream_end' && msg.channelId === channelId) {
				const sr = state.streamRenderer
				state.streamRenderer = null
				if (sr) 
					try {
						await sr.finish()
					}
					catch (e) {
						Sentry.captureException(e)
						console.error('group stream finish failed:', e)
					}
				
				if (state.volatileStreamId) state.volatileStreamReorderState.delete(state.volatileStreamId)
				setTimeout(() => {
					state.volatileStreamEl?.remove()
					state.volatileStreamEl = null
					state.volatileStreamId = null
					void loadMessages()
				}, 200)
			}
			// AI 定频自动触发
			if (msg.type === 'ai_auto_trigger' && msg.channelId === channelId && msg.groupId === groupId)
				// 调用 chat 生成接口（与 @mention 走相同路径：向 chatId=groupId 发送空触发消息）
				fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/message`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ reply: { content: '', groupChannelId: channelId, isAutoTrigger: true } }),
				}).catch(e => {
					Sentry.captureException(e)
					console.error('ai_auto_trigger message POST failed:', e)
				})

			if (msg.type === 'webrtc_signal' && msg.channelId === channelId && state.avSession)
				state.avSession.handleSignal(msg)
		}
		catch (e) {
			Sentry.captureException(e)
			console.error('group WebSocket onmessage handler failed:', e)
		}
	}
}
