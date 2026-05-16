import * as Sentry from 'https://esm.sh/@sentry/browser'

import { geti18n, main_locale, setLocalizeLogic } from '../../../../../../pages/scripts/i18n.mjs'
import { renderMarkdown, renderMarkdownAsString, renderMarkdownAsStandAloneHtmlString } from '../../../../../../pages/scripts/markdown.mjs'
import { onElementRemoved } from '../../../../../../pages/scripts/onElementRemoved.mjs'
import { renderTemplate, renderTemplateAsHtmlString } from '../../../../../../pages/scripts/template.mjs'
import { showToastI18n } from '../../../../../../scripts/toast.mjs'
import { preprocessChatMarkdown } from '../chatMarkdown.mjs'
import { modifyTimeLine, setCurrentChannel } from '../endpoints.mjs'
import { getfile } from '../files.mjs'
import { attachOffscreenEmbedGuard } from '../groupMode.mjs'
import { arrayBufferToBase64, handleUIError, normalizeError, SWIPE_THRESHOLD } from '../utils.mjs'

import { createAvatarElement } from './avatar.mjs'
import { onClickOutside } from './clickOutside.mjs'
import { escapeHtml, formatGroupMessageLine, tallyReactions } from './dagMessageUtils.mjs'
import { showEmojiPicker } from './emojiPicker.mjs'
import { attachShiftToggleMessageActions } from './messageActionShift.mjs'

/**
 * 绑定 `data-i18n-title`（核心 i18n 仅处理 `data-i18n`），语言切换时同步 `title`。
 * @param {ParentNode} root 根节点
 * @returns {void}
 */
function bindI18nTitleAttributes(root) {
	for (const el of root.querySelectorAll('[data-i18n-title]')) {
		if (!(el instanceof HTMLElement)) continue
		const titleKey = el.dataset.i18nTitle
		if (!titleKey) continue
		setLocalizeLogic(el, () => {
			el.title = geti18n(titleKey)
		})
	}
}

const CHAT_MSG_EDIT_FADE_MS = 200

/**
 * 是否应跳过动画（系统偏好减少动态效果）。
 * @returns {boolean} 为 true 时跳过淡入淡出
 */
function chatMsgEditPrefersReducedMotion() {
	try {
		return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
	}
	catch {
		return false
	}
}

/**
 * 是否应弱化滑动手势（与系统「减少动态效果」一致时仅保留按钮导航）。
 * @returns {boolean} 为 true 时不挂载多时间线滑动手势，仍可用 ◀/▶ 按钮
 */
function chatTimelineSwipePrefersReducedGesture() {
	return chatMsgEditPrefersReducedMotion()
}

/**
 * 连续两帧后再继续，确保浏览器已提交 opacity 起始样式。
 * @returns {Promise<void>} 在下一帧之后再下一帧 resolve
 */
function chatMsgEditWaitDoubleRaf() {
	return new Promise(resolve => {
		requestAnimationFrame(() => {
			requestAnimationFrame(resolve)
		})
	})
}

/**
 * 等待元素上 opacity 的 transition 结束（带超时兜底）。
 * @param {HTMLElement} el 正在过渡的节点
 * @returns {Promise<void>} transitionend 或超时后 resolve
 */
function chatMsgEditWaitOpacityTransitionEnd(el) {
	return new Promise(resolve => {
		/**
		 *
		 */
		const done = () => {
			el.removeEventListener('transitionend', onEnd)
			resolve()
		}
		/**
		 * @param {TransitionEvent} ev 单次 transition 结束事件
		 */
		const onEnd = ev => {
			if (ev.propertyName === 'opacity') done()
		}
		el.addEventListener('transitionend', onEnd, { passive: true })
		setTimeout(done, CHAT_MSG_EDIT_FADE_MS + 100)
	})
}

/**
 * 以 opacity 交叉淡入淡出替换节点（保留 `message_edit` / `loadMessages` 语义，仅改变呈现节奏）。
 * @param {HTMLElement} oldEl 被移出文档的节点
 * @param {HTMLElement} newEl 插入到原位置的节点
 * @returns {Promise<void>} 两段过渡完成后 resolve
 */
async function chatMsgEditReplaceWithCrossfade(oldEl, newEl) {
	if (chatMsgEditPrefersReducedMotion()) {
		oldEl.replaceWith(newEl)
		return
	}
	oldEl.classList.add('chat-msg-edit-fade')
	oldEl.style.opacity = '1'
	await chatMsgEditWaitDoubleRaf()
	oldEl.style.opacity = '0'
	await chatMsgEditWaitOpacityTransitionEnd(oldEl)
	oldEl.replaceWith(newEl)
	newEl.classList.add('chat-msg-edit-fade')
	newEl.style.opacity = '0'
	await chatMsgEditWaitDoubleRaf()
	newEl.style.opacity = '1'
	await chatMsgEditWaitOpacityTransitionEnd(newEl)
	newEl.classList.remove('chat-msg-edit-fade')
	newEl.style.opacity = ''
	newEl.style.transition = ''
}

/**
 * 构造群聊单条消息的渲染与上下文菜单、时间线导航能力。
 * @param {{
 *   groupId: string,
 *   channelId: string,
 *   msgBox: HTMLElement,
 *   loadMessages: () => Promise<void>,
 *   getDisplayMessages: () => object[],
 *   getMemberAvatarCache: () => Map<string, string>,
 *   toggleReaction: (eventId: string, emoji: string, byMe: boolean) => Promise<void>,
 *   fetchGroupFileAsBlob: (fileId: string, mime: string) => Promise<string | null>,
 *   downloadGroupFile: (fileId: string, name: string) => void,
 *   loadBookmarks: () => Promise<void>,
 *   getDmBlocklist: () => object[],
 *   setDmBlocklist: (next: object[]) => void,
 *   getEditedIds?: () => Set<string>,
 *   onContentResize?: () => void,
 *   onOpenThread?: (threadChannelId: string, threadTitle?: string) => void,
 *   getBranchInfo?: () => Map<string, { alternatives: object[], selectedIdx: number, branchKey: string }>,
 *   onBranchSelect?: (branchKey: string, selectedEventId: string) => void,
 * }} ctx 群聊 UI 依赖（消息列表、头像缓存、表情与文件处理等）。
 * @returns {{ renderMessageItem: (m: object, index: number) => Promise<HTMLElement>, showMessageMenu: (e: MouseEvent, m: object, bubble: HTMLElement) => Promise<void>, attachLastMessageTimeline: (merged: object[]) => Promise<void> }} 渲染与菜单、时间线方法集合
 */
export function createMessageItemRenderer(ctx) {
	const {
		groupId,
		channelId,
		msgBox,
		loadMessages,
		getDisplayMessages,
		getMemberAvatarCache,
		toggleReaction,
		fetchGroupFileAsBlob,
		downloadGroupFile,
		loadBookmarks,
		getDmBlocklist,
		setDmBlocklist,
		getEditedIds,
		onContentResize,
		onOpenThread,
		getBranchInfo,
		onBranchSelect,
	} = ctx

	/**
	 * 判定消息是否与本机角色交互相关（用于本地专属 hover 操作与反馈交互）。
	 * @param {object} m 消息对象
	 * @returns {boolean} 仅本机角色消息返回 true
	 */
	function isLocalRoleRelatedMessage(m) {
		return m?.type === 'message'
			&& !m?.isRemote
			&& !!m?.sender
			&& m.sender !== 'local'
	}

	/**
	 * 构造与 `standalone_message` 模板兼容的 message 载荷（含发送者/时间引用块）。
	 * @param {object} m 群聊消息行
	 * @param {string} rawMarkdown 原始 Markdown（不含引用头）
	 * @param {string} senderLabel 发送者显示名
	 * @returns {{ id: string, content: string, content_for_show: string }} 供独立页模板使用的 message 对象
	 */
	function buildStandaloneTemplateMessage(m, rawMarkdown, senderLabel) {
		const ts = m.timestamp
		const timeStr = ts != null && Number.isFinite(Number(ts))
			? new Date(Number(ts)).toLocaleString()
			: ''
		const safeSender = String(senderLabel).replace(/\s+/g, ' ').trim() || '?'
		const prelude = timeStr
			? geti18n('chat.group.quoteHeaderWithTime', { sender: safeSender, time: timeStr })
			: geti18n('chat.group.quoteHeaderWithoutTime', { sender: safeSender })
		const bodyMarkdown = prelude + String(rawMarkdown || '')
		return {
			id: m.eventId || `msg-${m.timestamp || Date.now()}`,
			content: bodyMarkdown,
			content_for_show: bodyMarkdown,
		}
	}

	/**
	 * 生成可离线查看的完整消息 HTML（与 master `messageList.generateFullHtmlForMessage` 对齐）。
	 * @param {object} message `standalone_message` 所需字段
	 * @param {object} [cache] Markdown 渲染缓存（与气泡内 pipeline 共享）
	 * @returns {Promise<string>} 完整 HTML 文档字符串
	 */
	async function generateFullHtmlForMessage(message, cache) {
		/**
		 * 将 Markdown 交给独立页管线渲染（与气泡共用 cache）。
		 * @param {string} markdown Markdown 源文本
		 * @returns {Promise<string>} 独立 HTML 片段
		 */
		function renderStandaloneMarkdown(markdown) {
			return renderMarkdownAsStandAloneHtmlString(markdown, cache)
		}
		return renderTemplateAsHtmlString('standalone_message', {
			main_locale,
			message,
			renderMarkdownAsStandAloneHtmlString: renderStandaloneMarkdown,
			geti18n,
			getfile,
			arrayBufferToBase64,
		})
	}

	/**
	 * 置顶或取消置顶某条消息。
	 * @param {string} targetEventId 目标消息 eventId
	 * @param {boolean} unpin 为 true 时执行取消置顶
	 * @returns {Promise<void>}
	 */
	async function postPin(targetEventId, unpin) {
		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/pin`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(unpin ? { targetEventId, unpin: true } : { targetEventId }),
		})
		if (r.ok) {
			await loadMessages()
			showToastI18n('success', unpin ? 'chat.group.unpinOk' : 'chat.group.pinOk')
		}
		else handleUIError(new Error(`pin HTTP ${r.status}`), 'chat.group.pinFailed', 'postPin')
	}

	/**
	 * 在最后一条非用户消息上附加时间线导航（◀/▶ + swipe）。
	 * 若已有链式分支信息（branchInfo），则导航已由 renderMessageItem 处理，跳过。
	 * @param {object[]} merged 合并后的消息列表
	 * @returns {Promise<void>}
	 */
	async function attachLastMessageTimeline(merged) {
		if (getBranchInfo?.()?.size > 0) return
		const lastMsg = [...merged].reverse().find(m => m.type === 'message' && m.sender && m.sender !== 'local')
			|| [...merged].reverse().find(m => m.type === 'message')
		if (!lastMsg?.eventId) return

		const el = msgBox.querySelector(`[data-event-anchor="${CSS.escape(lastMsg.eventId)}"]`)
		if (!el) return

		el.querySelector('[data-timeline-nav]')?.remove()

		let timelineInfo
		try {
			const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/timeline`)
			if (r.ok) timelineInfo = await r.json()
		}
		catch (e) {
			Sentry.captureException(e)
			console.error('attachLastMessageTimeline timeline fetch failed:', e)
		}

		const timelineOk = timelineInfo && typeof timelineInfo.total === 'number'
		const current = timelineOk ? timelineInfo.current : 0
		const total = timelineOk ? timelineInfo.total : 1

		if (timelineOk && total <= 1) return

		const nav = /** @type {HTMLElement} */ await renderTemplate('group_timeline_nav', {})
		const prevBtn = nav.querySelector('[data-timeline-prev]')
		const label = nav.querySelector('[data-timeline-label]')
		const nextBtn = nav.querySelector('[data-timeline-next]')
		if (label) {
			label.textContent = timelineOk ? `${current + 1}/${total}` : ''
			label.hidden = !timelineOk
		}
		if (prevBtn instanceof HTMLButtonElement) {
			prevBtn.disabled = timelineOk && current <= 0
			prevBtn.addEventListener('click', async () => {
				setCurrentChannel(groupId, channelId, 'chat')
				await modifyTimeLine(-1)
				await loadMessages()
			})
		}
		if (nextBtn instanceof HTMLButtonElement) {
			nextBtn.disabled = timelineOk && current >= total - 1
			nextBtn.addEventListener('click', async () => {
				setCurrentChannel(groupId, channelId, 'chat')
				await modifyTimeLine(1)
				await loadMessages()
			})
		}

		const bubble = el.querySelector('.chat-bubble')
		if (bubble) bubble.after(nav)
		else el.appendChild(nav)

		if (!chatTimelineSwipePrefersReducedGesture()) {
			let touchStartX = 0
			el.addEventListener('touchstart', e => {
				touchStartX = e.touches[0].clientX
			}, { passive: true })
			el.addEventListener('touchend', async e => {
				if (e.target instanceof Element && e.target.closest('[data-char-swipe-timeline]'))
					return
				const delta = e.changedTouches[0].clientX - touchStartX
				if (Math.abs(delta) < SWIPE_THRESHOLD) return
				setCurrentChannel(groupId, channelId, 'chat')
				await modifyTimeLine(delta < 0 ? 1 : -1)
				await loadMessages()
			}, { passive: true })
		}
	}

	/**
	 * 显示消息高级操作浮动菜单。
	 * @param {MouseEvent} e 鼠标事件（用于定位）
	 * @param {object} m 消息数据对象
	 * @param {HTMLElement} bubble 气泡元素
	 * @returns {Promise<void>}
	 */
	async function showMessageMenu(e, m, bubble) {
		document.querySelector('.msg-ctx-menu')?.remove()

		const textContent = m.type === 'message'
			? typeof m.content === 'string' ? m.content : m.content?.text || ''
			: bubble.textContent || ''

		const showTextActions = !!textContent
		const showThreadRow = !!(m.eventId && m.type === 'message')
		const showCopyIdRow = !!m.eventId
		if (!showTextActions && !showThreadRow && !showCopyIdRow) return

		const menu = /** @type {HTMLElement} */ await renderTemplate('group_message_ctx_menu', {
			showTextActions,
			showThreadRow,
			showCopyIdRow,
		})
		menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`
		menu.style.top = `${Math.min(e.clientY, window.innerHeight - 200)}px`

		menu.addEventListener('click', async ev => {
			const t = ev.target
			if (!(t instanceof Element)) return
			const btn = t.closest('[data-action]')
			if (!btn || !menu.contains(btn)) return
			const action = btn.getAttribute('data-action')

			if (action === 'copy') {
				await navigator.clipboard.writeText(textContent).catch(err => {
					console.error('clipboard writeText failed:', err)
				})
				menu.remove()
				showToastI18n('success', 'chat.group.copied')
				return
			}
			if (action === 'exportHtml') {
				menu.remove()
				const mdCache = {}
				const standMsg = buildStandaloneTemplateMessage(m, textContent, m.sender || '?')
				const html = await generateFullHtmlForMessage(standMsg, mdCache)
				const blob = new Blob([html], { type: 'text/html' })
				const url = URL.createObjectURL(blob)
				// 程序化触发 Blob 下载：仅需临时 <a> 的 href/download/click，无复用 UI 价值故不模板化。
				const a = document.createElement('a')
				a.href = url
				a.download = `message_${m.eventId || Date.now()}.html`
				document.body.appendChild(a)
				a.click()
				document.body.removeChild(a)
				setTimeout(() => URL.revokeObjectURL(url), 10_000)
				return
			}
			if (action === 'shareExternal') {
				menu.remove()
				try {
					const { createShareLink } = await import('../share.mjs')
					const mdCache = {}
					const standMsg = buildStandaloneTemplateMessage(m, textContent, m.sender || '?')
					const html = await generateFullHtmlForMessage(standMsg, mdCache)
					const blob = new Blob([html], { type: 'text/html' })
					const filename = `message_${m.eventId || Date.now()}.html`
					const shareUrl = await createShareLink(blob, filename, '1h')
					await navigator.clipboard.writeText(shareUrl).catch(err => {
						if (!(err instanceof DOMException) || (
							err.name !== 'NotAllowedError' &&
							err.name !== 'SecurityError'
						)) throw err
					})
					showToastI18n('success', 'chat.group.shareExternalOk')
				}
				catch (err) {
					handleUIError(normalizeError(err), 'chat.group.shareExternalFailed', 'share external')
				}
				return
			}
			if (action === 'openThread') {
				menu.remove()
				try {
					const r = await fetch(
						`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/threads`,
						{
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ parentEventId: m.eventId }),
						},
					)
					if (r.ok) {
						const data = await r.json()
						if (data.channelId) {
							showToastI18n('success', 'chat.group.threadCreated')
							if (typeof onOpenThread === 'function') {
								const line = formatGroupMessageLine(m).trim()
								const threadTitle = line.length > 72 ? `${line.slice(0, 72)}…` : line
								onOpenThread(data.channelId, threadTitle || undefined)
							}
							else {
								const card = await renderTemplate('group_message_thread_fallback_card', {
									threadHref: `#${groupId}:${data.channelId}`,
								})
								const host = card instanceof DocumentFragment ? card.firstElementChild : card
								if (host) bubble.closest('.flex-1')?.appendChild(host)
							}
						}
						else handleUIError(new Error('thread create: missing channelId'), 'chat.group.threadCreateFailed', 'thread create')
					}
					else handleUIError(new Error(`thread create HTTP ${r.status}`), 'chat.group.threadCreateFailed', 'thread create')
				}
				catch (err) {
					handleUIError(normalizeError(err), 'chat.group.threadCreateFailed', 'thread create')
				}
				return
			}
			if (action === 'copyEventId') {
				await navigator.clipboard.writeText(m.eventId).catch(err => {
					console.error('clipboard writeText (eventId) failed:', err)
				})
				menu.remove()
			}
		})

		document.body.appendChild(menu)
		let popoverShown = false
		if (typeof menu.showPopover === 'function') {
			menu.addEventListener('toggle', () => {
				try {
					if (!menu.matches(':popover-open') && menu.isConnected)
						queueMicrotask(() => menu.remove())
				}
				catch {
					queueMicrotask(() => {
						if (menu.isConnected) menu.remove()
					})
				}
			})
			try {
				menu.showPopover()
				popoverShown = true
			}
			catch (e) {
				if (!(e instanceof DOMException)) throw e
			}
		}
		if (!popoverShown) {
			/** @type {(() => void) | null} */
			let cleanup = null
			setTimeout(() => {
				cleanup = onClickOutside(menu, () => {
					menu.remove()
					cleanup?.()
				})
			}, 0)
		}
	}

	/**
	 * 渲染单条消息为 DOM 元素。
	 * @param {object} m 消息对象（来自 mergeChannelMessagesForDisplay）
	 * @param {number} _index 在列表中的索引
	 * @returns {Promise<HTMLElement>} 渲染好的消息容器
	 */
	async function renderMessageItem(m) {
		const displayMessages = getDisplayMessages()
		const memberAvatarCache = getMemberAvatarCache()
		const div = /** @type {HTMLElement} */ await renderTemplate('group_message_row_shell', {})
		if (isLocalRoleRelatedMessage(m))
			div.dataset.localRoleRelated = '1'
		if (m.eventId)
			div.setAttribute('data-event-anchor', String(m.eventId))
		const avatarSlot = /** @type {HTMLElement | null} */ div.querySelector('[data-slot="avatar"]')
		const mainSlot = /** @type {HTMLElement | null} */ div.querySelector('[data-slot="main"]')
		const actionsSlot = /** @type {HTMLElement | null} */ div.querySelector('[data-slot="actions"]')
		const bubbleClass = m.type === 'message_feedback'
			? 'chat-bubble chat-bubble-secondary text-sm opacity-90'
			: 'chat-bubble'
		const entryId = m.content?.chatLogEntryId
		const headerBubbleRoot = await renderTemplate('group_message_header_bubble', {
			bubbleClass,
		})
		const senderSlot = headerBubbleRoot.querySelector('[data-slot="sender"]')
		const timeSlot = headerBubbleRoot.querySelector('[data-slot="time"]')
		const editedSlot = headerBubbleRoot.querySelector('[data-slot="edited"]')
		if (senderSlot) senderSlot.textContent = String(m.sender || '')
		if (timeSlot) 
			if (m.timestamp) {
				const tsDate = new Date(Number(m.timestamp))
				timeSlot.textContent = tsDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				timeSlot.hidden = false
			}
			else {
				timeSlot.textContent = ''
				timeSlot.hidden = true
			}
		
		if (editedSlot) {
			const showEdited = typeof getEditedIds === 'function' && entryId && getEditedIds().has(String(entryId))
			editedSlot.hidden = !showEdited
		}
		const bubble = /** @type {HTMLElement | null} */ headerBubbleRoot.querySelector('[data-bubble-root]')
		if (!bubble) throw new Error('group_message_header_bubble: missing data-bubble-root')
		const messageRaw = m.type === 'message'
			? typeof m.content === 'string' ? m.content : m.content?.text || ''
			: ''
		const fileCount = m.type === 'message' ? Number(m.content?.fileCount) || 0 : 0
		if (m.type === 'message' && String(messageRaw).trim()) {
			bubble.textContent = String(messageRaw)
			if (fileCount > 0) {
				const hintSpan = /** @type {HTMLElement} */ await renderTemplate('group_message_attach_hint', {})
				setLocalizeLogic(hintSpan, () => {
					hintSpan.textContent = geti18n('chat.group.attachmentsHint', { n: fileCount })
				})
				bubble.appendChild(hintSpan)
			}
		}
		else {
			const lineEl = await formatGroupMessageLine(m, displayMessages)
			bubble.replaceChildren(lineEl)
		}
		bubble.addEventListener('click', e => {
			if (!e.shiftKey) return
			e.stopPropagation()
			e.preventDefault()
			void showMessageMenu(e, m, bubble)
		})
		mainSlot.appendChild(headerBubbleRoot)
		const parentEventId = m.content?.parentEventId
		if (parentEventId) {
			const refBlock = /** @type {HTMLElement} */ await renderTemplate('group_message_ref_block', {})
			refBlock.setAttribute('data-parent-event-id', String(parentEventId))
			setLocalizeLogic(refBlock, () => {
				refBlock.textContent = geti18n('chat.group.messageRefAnchor', { id: parentEventId })
			})
			refBlock.addEventListener('click', () => {
				const target = msgBox.querySelector(`[data-event-anchor="${CSS.escape(String(parentEventId))}"]`)
				if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
			})
			mainSlot.appendChild(refBlock)
		}
		const lateMs = 30_000
		const ra = Number(m.receivedAt)
		const msgTsNum = Number(m.timestamp)
		if (Number.isFinite(ra) && Number.isFinite(msgTsNum) && ra - msgTsNum > lateMs) {
			const late = /** @type {HTMLElement} */ await renderTemplate('group_message_late_notice', {})
			mainSlot.appendChild(late)
		}
		const sender = m.sender || '?'
		const cachedAvatar = memberAvatarCache.get(sender)
		avatarSlot.appendChild(createAvatarElement(sender, cachedAvatar))

		/**
		 * 打开行内编辑面板（与原先 edit 按钮行为一致）。
		 * @returns {Promise<void>}
		 */
		async function runMessageEdit() {
			const currentText = m.content?.text || ''
			const editContainer = /** @type {HTMLElement} */ await renderTemplate('group_message_edit_panel', {})
			const editTextarea = /** @type {HTMLTextAreaElement | null} */ editContainer.querySelector('[data-edit-textarea]')
			const confirmBtn = editContainer.querySelector('[data-edit-confirm]')
			const cancelBtn = editContainer.querySelector('[data-edit-cancel]')
			if (!editTextarea || !(confirmBtn instanceof HTMLButtonElement) || !(cancelBtn instanceof HTMLButtonElement))
				return
			editTextarea.value = currentText
			editTextarea.rows = 1

			/**
			 *
			 */
			const autoResize = () => {
				editTextarea.style.height = 'auto'
				editTextarea.style.height = `${editTextarea.scrollHeight}px`
			}
			editTextarea.addEventListener('input', autoResize)
			setTimeout(autoResize, 0)

			await chatMsgEditReplaceWithCrossfade(bubble, editContainer)
			editTextarea.focus()
			editTextarea.select()

			/**
			 * 取消编辑并恢复气泡视图。
			 * @returns {Promise<void>}
			 */
			const revertEditView = async () => {
				await chatMsgEditReplaceWithCrossfade(editContainer, bubble)
				editTextarea.removeEventListener('keydown', handleKeydown)
			}

			/**
			 * @param {KeyboardEvent} e 键盘事件
			 */
			const handleKeydown = (e) => {
				if (e.key === 'Escape') {
					e.preventDefault()
					void revertEditView()
				}
				if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
					e.preventDefault()
					void doConfirm()
				}
			}
			editTextarea.addEventListener('keydown', handleKeydown)

			/**
			 *
			 */
			const doConfirm = async () => {
				const newText = editTextarea.value.trim()
				if (!newText) {
					showToastI18n('warning', 'chat.group.editEmptyText')
					return
				}
				await chatMsgEditReplaceWithCrossfade(editContainer, bubble)
				editTextarea.removeEventListener('keydown', handleKeydown)
				const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/events`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: 'message_edit',
						channelId,
						sender: 'local',
						timestamp: Date.now(),
						content: { chatLogEntryId: m.content?.chatLogEntryId || m.eventId, text: newText },
					}),
				})
				if (r.ok)
					bubble.classList.add('ring-2', 'ring-primary/40')
				await loadMessages()
			}

			confirmBtn.addEventListener('click', () => {
				void doConfirm()
			})
			cancelBtn.addEventListener('click', () => {
				void revertEditView()
			})
		}

		const showUnpin = m.type === 'pin_message' && !!m.content?.targetId
		const showPin = m.type !== 'unpin_message' && !!m.eventId && !showUnpin
		const showDelete = m.type === 'message' && !!m.eventId
		const showEdit = m.type === 'message' && !!m.content?.text
		const showBookmark = !!m.eventId
		const showSaveSticker = !!(m.content?.stickerBase64 || m.type === 'sticker')
		const showBlockDm = !!(m.isRemote && m.sender)
		const showMore = !!(m.eventId || (m.type === 'message' && m.content?.text))
		const hasAnyAction = showUnpin || showPin || showDelete || showEdit || showBookmark || showSaveSticker || showBlockDm || showMore

		if (hasAnyAction && actionsSlot) {
			const actionsRoot = /** @type {HTMLElement} */ await renderTemplate('group_message_actions', {
				showUnpin,
				showPin,
				showDelete,
				showEdit,
				showBookmark,
				showSaveSticker,
				showBlockDm,
				showMore,
			})
			actionsSlot.appendChild(actionsRoot)
			bindI18nTitleAttributes(actionsRoot)

			/**
			 * 删除当前消息（需确认）。
			 * @returns {Promise<void>}
			 */
			const runDeleteMessageForAction = async () => {
				if (!globalThis.confirm(geti18n('chat.group.deleteConfirm') || 'Delete this message?')) return
				await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/events`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: 'message_delete',
						channelId,
						sender: 'local',
						timestamp: Date.now(),
						content: { chatLogEntryId: m.content?.chatLogEntryId || m.eventId },
					}),
				})
				await loadMessages()
			}

			/**
			 * 将消息加入书签列表。
			 * @returns {Promise<void>}
			 */
			const runBookmarkAction = async () => {
				const r0 = await fetch('/api/parts/shells:chat/bookmarks')
				if (!r0.ok) return
				const raw = await r0.json()
				const arr = Array.isArray(raw) ? [...raw] : []
				const exists = arr.some(e => e.groupId === groupId && e.eventId === m.eventId)
				if (!exists) {
					const preview = typeof m.content?.text === 'string' ? m.content.text.slice(0, 40) : m.eventId.slice(0, 12)
					arr.push({ groupId, channelId, eventId: m.eventId, title: preview, href: `#${groupId}:${channelId}` })
					await fetch('/api/parts/shells:chat/bookmarks', {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ entries: arr }),
					})
					await loadBookmarks()
				}
				showToastI18n('success', 'chat.group.bookmarkAdded')
			}

			/**
			 * 保存贴纸到收藏。
			 * @returns {Promise<void>}
			 */
			const runSaveStickerAction = async () => {
				const b64 = m.content?.stickerBase64
				if (!b64) return
				const r0 = await fetch('/api/parts/shells:chat/stickers')
				const raw = r0.ok ? await r0.json() : []
				const items = Array.isArray(raw) ? [...raw] : []
				const name = m.content?.name || geti18n('chat.group.stickerDefaultName')
				if (!items.some(s => s.base64 === b64)) {
					items.push({ name, base64: b64, overlay: m.content?.overlay || null })
					await fetch('/api/parts/shells:chat/stickers', {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ items }),
					})
				}
				showToastI18n('success', 'chat.group.stickerSaved')
			}

			/**
			 * 拉黑远程发送者。
			 * @returns {Promise<void>}
			 */
			const runBlockDmAction = async () => {
				if (!globalThis.confirm(geti18n('chat.group.blockConfirm', { sender: m.sender }))) return
				await fetch('/api/parts/shells:chat/dm-blocklist', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ pubKeyHash: m.sender, groupId }),
				})
				setDmBlocklist([...getDmBlocklist(), { pubKeyHash: m.sender, groupId }])
				showToastI18n('success', 'chat.group.blockAdded')
			}

			actionsRoot.addEventListener('click', e => {
				const t = e.target
				if (!(t instanceof Element)) return
				const btn = t.closest('[data-action]')
				if (!btn || !actionsRoot.contains(btn)) return
				const action = btn.getAttribute('data-action')

				if (action === 'unpin') {
					void postPin(String(m.content.targetId), true)
					return
				}
				if (action === 'pin') {
					void postPin(m.eventId, false)
					return
				}
				if (action === 'delete') {
					void runDeleteMessageForAction()
					return
				}
				if (action === 'edit') {
					void runMessageEdit()
					return
				}
				if (action === 'bookmark') {
					void runBookmarkAction()
					return
				}
				if (action === 'saveSticker') {
					void runSaveStickerAction()
					return
				}
				if (action === 'blockDm') {
					void runBlockDmAction()
					return
				}
				if (action === 'more') {
					e.stopPropagation()
					void showMessageMenu(e, m, bubble)
				}
			})

			attachShiftToggleMessageActions(div, actionsRoot)
		}

		// vote 投票按钮
		if (m.content?.kind === 'vote' && m.eventId) {
			const voteDeadline = m.content?.deadline
			const voteClosed = voteDeadline && new Date(voteDeadline) < new Date()
			if (!voteClosed) {
				const opts = m.content.options || []
				const voteContainer = /** @type {HTMLElement} */ await renderTemplate('group_message_vote_options', {})
				const voteHost = voteContainer.querySelector('[data-vote-options]')
				const btnProto = /** @type {HTMLElement} */ await renderTemplate('group_message_vote_option_btn', {})
				const protoBtn = btnProto instanceof HTMLButtonElement
					? btnProto
					: /** @type {HTMLButtonElement | null} */ btnProto.querySelector('button')
				if (voteHost && protoBtn) 
					for (let i = 0; i < opts.length; i++) {
						const btn = /** @type {HTMLButtonElement} */ protoBtn.cloneNode(true)
						btn.setAttribute('data-choice-index', String(i))
						voteHost.appendChild(btn)
					}
				
				for (const btn of voteContainer.querySelectorAll('[data-choice-index]')) {
					if (!(btn instanceof HTMLButtonElement)) continue
					const idx = Number(btn.getAttribute('data-choice-index'))
					const opt = opts[idx]
					if (opt == null) continue
					setLocalizeLogic(btn, () => {
						btn.textContent = geti18n('chat.group.voteFor', { option: opt })
					})
				}

				/**
				 * 提交投票选择并刷新列表。
				 * @param {string} choice 选项文案
				 * @returns {Promise<void>}
				 */
				const castVoteChoice = async choice => {
					await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/events`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							type: 'vote_cast',
							channelId,
							sender: 'local',
							timestamp: Date.now(),
							content: { ballotId: m.eventId, choice },
						}),
					})
					await loadMessages()
				}

				voteContainer.addEventListener('click', e => {
					const t = e.target
					if (!(t instanceof Element)) return
					const vBtn = t.closest('[data-choice-index]')
					if (!vBtn || !voteContainer.contains(vBtn)) return
					const idx = Number(vBtn.getAttribute('data-choice-index'))
					const choice = opts[idx]
					if (choice == null) return
					void castVoteChoice(choice)
				})
				mainSlot.appendChild(voteContainer)
			}
		}

		if (m.content?.fileId && m.content?.name) {
			const mime = m.content.mimeType || ''
			const isImage = mime.startsWith('image/')
			const isVideo = mime.startsWith('video/')
			const isAudio = mime.startsWith('audio/')

			if (isImage || isVideo || isAudio) {
				/** @type {HTMLElement} */
				const mediaWrap = isAudio
					? /** @type {HTMLElement} */ await renderTemplate('group_message_media_audio', {})
					: /** @type {HTMLElement} */ await renderTemplate('group_message_media_placeholder', {})
				if (!isAudio) {
					const iconSlot = mediaWrap.querySelector('[data-media-icon]')
					const nameSlot = mediaWrap.querySelector('[data-media-filename]')
					if (nameSlot) nameSlot.textContent = String(m.content.name)
					if (iconSlot) {
						const iconTpl = await renderTemplate(
							isImage ? 'group_message_media_icon_image' : 'group_message_media_icon_video',
							{},
						)
						const iconNode = iconTpl instanceof DocumentFragment
							? iconTpl.firstElementChild
							: iconTpl
						if (iconNode) iconSlot.appendChild(iconNode)
					}
				}

				if (isAudio) {
					const audioEl = /** @type {HTMLAudioElement | null} */ mediaWrap.querySelector('audio')
					if (audioEl) {
						let loaded = false
						audioEl.addEventListener('play', async () => {
							if (loaded) return
							loaded = true
							audioEl.pause()
							const url = await fetchGroupFileAsBlob(m.content.fileId, mime)
							if (url) {
								audioEl.src = url
								audioEl.play().catch(e => {
									if (e instanceof DOMException && (
										e.name === 'NotAllowedError' ||
										e.name === 'AbortError' ||
										e.name === 'NotSupportedError'
									)) return
									if (e?.name === 'AbortError') return
									throw e
								})
							}
							else showToastI18n('error', 'chat.group.fileLoadFailed')
						}, { once: false })
					}
				}
				else {
					const placeholder = mediaWrap.querySelector('[data-media-placeholder]')
					if (placeholder instanceof HTMLElement) 
						placeholder.addEventListener('click', async () => {
							placeholder.replaceChildren()
							const loading = await renderTemplate('group_message_media_loading', {})
							placeholder.appendChild(loading)
							const url = await fetchGroupFileAsBlob(m.content.fileId, mime)
							if (!url) {
								placeholder.replaceChildren()
								const errSpan = /** @type {HTMLElement} */ await renderTemplate('group_message_media_error', {})
								setLocalizeLogic(errSpan, () => {
									errSpan.textContent = geti18n('chat.group.fileLoadFailed')
								})
								placeholder.appendChild(errSpan)
								return
							}
							if (isImage) {
								const img = /** @type {HTMLImageElement} */ await renderTemplate('group_message_media_image', {
									url,
									altEscaped: escapeHtml(String(m.content.name)),
								})
								img.addEventListener('click', () => window.open(url, '_blank'))
								placeholder.replaceWith(img)
								img.addEventListener('load', () => onContentResize?.(), { once: true })
							} else {
								const video = /** @type {HTMLVideoElement} */ await renderTemplate('group_message_media_video', { url })
								placeholder.replaceWith(video)
								video.addEventListener('loadedmetadata', () => onContentResize?.(), { once: true })
							}
						})
					
				}
				mainSlot.appendChild(mediaWrap)
			} else {
				const dlBtn = /** @type {HTMLElement} */ await renderTemplate('group_message_file_download', {
					fileNameEscaped: escapeHtml(String(m.content.name)),
				})
				if (dlBtn instanceof HTMLButtonElement) {
					setLocalizeLogic(dlBtn, () => {
						dlBtn.title = geti18n('chat.group.fileDownload')
					})
					dlBtn.addEventListener('click', () => downloadGroupFile(m.content.fileId, m.content.name))
				}
				mainSlot.appendChild(dlBtn)
			}
		}

		if (actionsSlot && !actionsSlot.childElementCount)
			actionsSlot.remove()

		// ─── Reactions（仅本机角色相关消息可交互） ─────────────────────────────────────
		const isLocalRoleRelated = isLocalRoleRelatedMessage(m)
		if (m.type === 'message' && m.eventId && isLocalRoleRelated) {
			const reactions = tallyReactions(displayMessages, m.eventId)
			const reactRow = /** @type {HTMLElement} */ await renderTemplate('group_message_reactions_row', {})
			const addReactionBtn = reactRow.querySelector('[data-action="addReaction"]')
			const badgeProto = /** @type {HTMLElement} */ await renderTemplate('group_message_reaction_badge', {})
			const protoBadge = badgeProto instanceof HTMLButtonElement
				? badgeProto
				: /** @type {HTMLButtonElement | null} */ badgeProto.querySelector('[data-action="reaction"]')
			if (addReactionBtn && protoBadge) 
				for (const [emoji, { count, byMe }] of reactions) {
					const badge = /** @type {HTMLButtonElement} */ protoBadge.cloneNode(true)
					badge.className = byMe
						? 'btn btn-xs rounded-full gap-0.5 btn-primary'
						: 'btn btn-xs rounded-full gap-0.5 btn-ghost border border-base-300'
					badge.setAttribute('data-emoji', String(emoji))
					badge.textContent = `${emoji} ${count}`
					addReactionBtn.before(badge)
				}
			
			for (const badge of reactRow.querySelectorAll('[data-action="reaction"]')) {
				if (!(badge instanceof HTMLButtonElement)) continue
				const byMe = badge.classList.contains('btn-primary')
				setLocalizeLogic(badge, () => {
					badge.title = byMe ? geti18n('chat.group.reactionRemove') : geti18n('chat.group.reactionAdd')
				})
			}
			reactRow.addEventListener('click', async e => {
				const t = e.target
				if (!(t instanceof Element)) return
				const addBtn = t.closest('[data-action="addReaction"]')
				if (addBtn && reactRow.contains(addBtn)) {
					e.stopPropagation()
					void showEmojiPicker(e, emoji => {
						void toggleReaction(m.eventId, emoji, false).then(() => loadMessages())
					})
					return
				}
				const badge = t.closest('[data-action="reaction"]')
				if (!badge || !reactRow.contains(badge)) return
				const emoji = badge.getAttribute('data-emoji')
				if (emoji == null) return
				const byMe = badge.classList.contains('btn-primary')
				await toggleReaction(m.eventId, emoji, byMe)
				await loadMessages()
			})
			if (addReactionBtn instanceof HTMLButtonElement)
				setLocalizeLogic(addReactionBtn, () => {
					addReactionBtn.title = geti18n('chat.group.addReaction')
				})

			div.appendChild(reactRow)
		}

		if (m.type === 'message' && (m.content?.text || typeof m.content === 'string')) {
			const raw = typeof m.content === 'string' ? m.content : m.content?.text || ''
			if (raw.trim()) {
				const preprocessed = await preprocessChatMarkdown(raw, { trusted: true })
				bubble.replaceChildren()
				const mdCache = {}
				bubble.appendChild(await renderMarkdown(preprocessed, mdCache))
				const stopEmbedGuard = attachOffscreenEmbedGuard(bubble)
				if (fileCount > 0) {
					const hintSpan = /** @type {HTMLElement} */ await renderTemplate('group_message_attach_hint', {})
					setLocalizeLogic(hintSpan, () => {
						hintSpan.textContent = geti18n('chat.group.attachmentsHint', { n: fileCount })
					})
					bubble.appendChild(hintSpan)
				}

				const standMsg = buildStandaloneTemplateMessage(m, raw, sender)
				const fullHtml = await generateFullHtmlForMessage(standMsg, mdCache)
				const standaloneMessageUrl = URL.createObjectURL(new Blob([fullHtml], { type: 'text/html' }))
				onElementRemoved(bubble, () => {
					stopEmbedGuard()
					URL.revokeObjectURL(standaloneMessageUrl)
				})
				const inlineFragmentHtml = await renderMarkdownAsString(preprocessed, mdCache)
				const exportFileName = `message-${standMsg.id}.html`

				bubble.draggable = true
				bubble.addEventListener('dragstart', e => {
					e.dataTransfer.setData('DownloadURL', `text/html:${exportFileName}:${standaloneMessageUrl}`)
					e.dataTransfer.effectAllowed = 'copy'
					e.dataTransfer.setData('text/plain', bubble.textContent.trim())
					e.dataTransfer.setData('text/markdown', raw)
					e.dataTransfer.setData('text/html', inlineFragmentHtml)
				})
			}
		}

		const branchData = getBranchInfo?.()?.get(m.eventId)
		if (branchData && branchData.alternatives.length > 1 && isLocalRoleRelated) {
			const { alternatives, selectedIdx, branchKey } = branchData
			const nav = /** @type {HTMLElement} */ await renderTemplate('group_timeline_nav', {})
			const prevBtn = nav.querySelector('[data-timeline-prev]')
			const label = nav.querySelector('[data-timeline-label]')
			const nextBtn = nav.querySelector('[data-timeline-next]')
			if (prevBtn instanceof HTMLButtonElement) {
				prevBtn.disabled = selectedIdx <= 0
				prevBtn.addEventListener('click', () => {
					const newSelected = alternatives[selectedIdx - 1]
					if (newSelected) onBranchSelect?.(branchKey, newSelected.eventId)
				})
			}
			if (label)
				label.textContent = `${selectedIdx + 1}/${alternatives.length}`
			if (nextBtn instanceof HTMLButtonElement) {
				nextBtn.disabled = selectedIdx >= alternatives.length - 1
				nextBtn.addEventListener('click', () => {
					const newSelected = alternatives[selectedIdx + 1]
					if (newSelected) onBranchSelect?.(branchKey, newSelected.eventId)
				})
			}

			if (bubble) bubble.after(nav)
			else div.appendChild(nav)
		}

		if (branchData && branchData.alternatives.length > 1 && isLocalRoleRelated) {
			bubble.setAttribute('data-char-swipe-timeline', '1')
			let touchStartX = 0
			bubble.addEventListener('touchstart', e => {
				touchStartX = e.touches[0].clientX
			}, { passive: true })
			bubble.addEventListener('touchend', e => {
				const dx = e.changedTouches[0].clientX - touchStartX
				if (Math.abs(dx) <= SWIPE_THRESHOLD) return
				e.stopPropagation()
				const direction = dx < 0 ? 1 : -1
				const { alternatives, selectedIdx, branchKey } = branchData
				const newIdx = selectedIdx + direction
				if (newIdx >= 0 && newIdx < alternatives.length)
					onBranchSelect?.(branchKey, alternatives[newIdx].eventId)
			}, { passive: true })
		}
		if (m.extension?.aborted === true) {
			bubble.classList.add('opacity-60', 'border-l-2', 'border-warning')
			if (!bubble.querySelector('[data-msg-aborted]')) {
				const abortedSpan = document.createElement('span')
				abortedSpan.dataset.msgAborted = '1'
				abortedSpan.className = 'text-warning text-xs block mt-1'
				setLocalizeLogic(abortedSpan, () => {
					abortedSpan.textContent = geti18n('chat.group.messageAborted')
				})
				bubble.appendChild(abortedSpan)
			}
		}
		return div
	}

	return { renderMessageItem, showMessageMenu, attachLastMessageTimeline }
}
