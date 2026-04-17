import * as Sentry from 'https://esm.sh/@sentry/browser'

import { renderTemplate } from '../../../../../../pages/scripts/template.mjs'
import { createVirtualList } from '../../../../../../pages/scripts/virtualList.mjs'
import { geti18n, setLocalizeLogic } from '../../../../../../scripts/i18n.mjs'
import { showToastI18n } from '../../../../../../scripts/toast.mjs'
import { viewerCanCryptoMigrate } from '../groupViewerPermissions.mjs'
import { handleUIError, normalizeError } from '../utils.mjs'

import { buildDisplayChain, mergeChannelMessagesForDisplay, orderedActivePinTargets, plainPreviewFromLine } from './dagMessageUtils.mjs'
import { addDragAndDropSupport } from './dragAndDrop.mjs'

/**
 * 创建频道视图控制器，管理消息加载、虚拟列表和增量 DAG patch。
 * @param {object} params 工厂参数集合
 * @param {string} params.groupId 群组 ID
 * @param {string} params.channelId 频道 ID
 * @param {HTMLElement} params.msgBox 消息容器元素
 * @param {HTMLInputElement | null} params.input 输入框元素
 * @param {AbortSignal} params.signal 生命周期信号
 * @param {object} params.state 共享可变状态（msgVirtualList、displayMessages 等）
 * @param {Function} params.getLastChannelMeta 获取当前频道元数据
 * @param {Function} params.getLastGroupSettings 获取当前群组配置
 * @param {Function} params.getMentionCharNames 获取可 @ 的角色名列表
 * @param {Function} params.getOpenedChannels 获取已打开频道 Set
 * @param {Function} params.enqueuePendingFile 添加待上传文件
 * @param {Function} params.switchChannelType 切换频道类型
 * @param {Function} params.setAsDefaultChannel 设为默认频道
 * @param {Function} [params.reloadStateAndMessages] 频道元数据更新后刷新群状态与消息
 * @param {Function} params.renderMessageItem 渲染单条消息 DOM
 * @param {Function} params.attachLastMessageTimeline 附加时间线到末尾消息
 * @param {Function} params.getActiveBranches 获取当前 activeBranches Map
 * @returns {{ loadMessages: Function, scheduleMessagePatch: Function }} 频道视图控制函数集合
 */
export function createChannelView({
	groupId,
	channelId,
	msgBox,
	input,
	signal,
	state,
	getLastChannelMeta,
	getLastGroupSettings,
	getMentionCharNames,
	getOpenedChannels,
	enqueuePendingFile,
	switchChannelType,
	setAsDefaultChannel,
	reloadStateAndMessages,
	renderMessageItem,
	attachLastMessageTimeline,
	getActiveBranches,
}) {
	/**
	 * 将 DAG 消息行调度进增量 patch 队列（同一 eventId 后写覆盖）。
	 * @param {object} line 消息行（含 eventId 字段）
	 * @returns {void}
	 */
	function scheduleMessagePatch(line) {
		if (!line || typeof line !== 'object') return
		const key = line.eventId || line.content?.chatLogEntryId || JSON.stringify(line)
		state.pendingEventMap.set(key, line)
		if (state.patchScheduled) return
		state.patchScheduled = true
		queueMicrotask(() => {
			state.patchScheduled = false
			if (signal.aborted) {
				state.pendingEventMap.clear()
				return
			}
			try {
				const lines = [...state.pendingEventMap.values()]
				state.pendingEventMap.clear()
				if (!lines.length) return
				let changed = false
				for (const l of lines) {
					const idx = state.rawMessages.findIndex(r => r.eventId === l.eventId)
					if (idx >= 0) {
						state.rawMessages[idx] = l
						changed = true
					}
					else {
						state.rawMessages.push(l)
						changed = true
					}
				}
				if (!changed) return
				const mergedPatch = mergeChannelMessagesForDisplay(state.rawMessages)
				const { messages: chainMessagesPatch, branchInfo: branchInfoPatch } = buildDisplayChain(mergedPatch, getActiveBranches?.() ?? new Map())
				state.displayMessages = chainMessagesPatch
				state.branchInfo = branchInfoPatch
				state.msgVirtualList?.refresh?.()
			}
			catch (e) {
				Sentry.captureException(e)
				console.error('scheduleMessagePatch flush failed, falling back to loadMessages:', e)
				void loadMessages()
			}
		})
	}

	/**
	 * 拉取并渲染当前频道的消息列表（虚拟列表或列表类型）。
	 * @returns {Promise<void>}
	 */
	const loadMessages = async () => {
		getOpenedChannels().add(channelId)
		const meta = getLastChannelMeta()
		const sendBtn = document.getElementById('group-send-button')
		if (meta?.type === 'list') {
			state.msgVirtualList?.destroy()
			state.msgVirtualList = null
			state.displayMessages = []
			state.rawMessages = []
			state.msgScrollContainer = null
			msgBox.classList.remove('flex', 'flex-col', 'min-h-0', 'overflow-hidden')
			if (!msgBox.classList.contains('overflow-y-auto'))
				msgBox.classList.add('overflow-y-auto')
			msgBox.innerHTML = ''
			const items = meta.manualItems || []
			if (!items.length) {
				const emptyP = document.createElement('p')
				emptyP.className = 'text-sm opacity-60 p-2'
				setLocalizeLogic(emptyP, () => {
					emptyP.textContent = geti18n('chat.group.listEmpty')
				})
				msgBox.appendChild(emptyP)
			}
			else
				for (const it of items) {
					const el = document.createElement('div')
					el.className = 'card card-compact bg-base-100 border border-base-300 p-3 mb-2'
					const href = it.targetChannelId
						? `#${groupId}:${encodeURIComponent(it.targetChannelId)}`
						: it.url || '#'
					const a = document.createElement('a')
					a.className = 'link link-primary font-medium'
					a.href = href
					a.textContent = it.title || ''
					if (it.url && !it.targetChannelId) {
						a.rel = 'noopener noreferrer'
						a.target = '_blank'
					}
					el.appendChild(a)
					if (it.desc) {
						const descP = document.createElement('p')
						descP.className = 'text-xs mt-1 opacity-80'
						descP.textContent = it.desc
						el.appendChild(descP)
					}
					msgBox.appendChild(el)
				}
			if (input) {
				input.disabled = true
				setLocalizeLogic(input, () => {
					if (!input || getLastChannelMeta()?.type !== 'list') return
					input.placeholder = geti18n('chat.group.listChannelReadonly')
				})
			}
			if (sendBtn) sendBtn.disabled = true

			// list 类型频道：在消息区顶部追加类型切换控件
			const ctrlBar = await renderTemplate('channel_ctrl_bar_list', {})
			const isDefault = getLastGroupSettings().defaultChannelId === channelId
			ctrlBar.querySelector('[data-show-if-not-default]')?.classList.toggle('hidden', isDefault)
			ctrlBar.querySelector('[data-show-if-default]')?.classList.toggle('hidden', !isDefault)
			ctrlBar.querySelector('[data-action="to-text"]')?.addEventListener('click', () => switchChannelType('text'))
			ctrlBar.querySelector('[data-action="set-default"]')?.addEventListener('click', () => setAsDefaultChannel())
			msgBox.insertBefore(ctrlBar, msgBox.firstChild)
			return
		}
		if (input) {
			input.disabled = false
			input.placeholder = ''
			setLocalizeLogic(input, () => {
				if (!input || getLastChannelMeta()?.type === 'list') return
				input.placeholder = ''
			})
		}
		if (sendBtn) sendBtn.disabled = false

		const isDefault = getLastGroupSettings().defaultChannelId === channelId
		const isChatChannel = !meta?.type || meta?.type === 'text'

		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/chat/${encodeURIComponent(channelId)}/messages`)
		if (!r.ok) {
			handleUIError(new Error(`loadMessages HTTP ${r.status}`), 'chat.group.messagesLoadFailed', 'loadMessages failed')
			return
		}
		const { messages } = await r.json()
		state.rawMessages = Array.isArray(messages) ? [...messages] : []
		const merged = mergeChannelMessagesForDisplay(state.rawMessages)
		const { messages: chainMessages, branchInfo } = buildDisplayChain(merged, getActiveBranches?.() ?? new Map())
		state.displayMessages = chainMessages
		state.branchInfo = branchInfo
		const volHold = state.volatileStreamEl
		if (volHold?.parentNode) volHold.parentNode.removeChild(volHold)
		state.msgVirtualList?.destroy()
		state.msgVirtualList = null
		msgBox.innerHTML = ''
		msgBox.classList.add('flex', 'flex-col', 'min-h-0', 'overflow-hidden')
		msgBox.classList.remove('overflow-y-auto')

		// text/streaming 类型频道：在顶部追加类型切换控件（须在清空 msgBox 之后挂载）
		let ctrlBar = null
		if (isChatChannel) {
			ctrlBar = await renderTemplate('channel_ctrl_bar_text', {})
			ctrlBar.querySelector('[data-show-if-not-default]')?.classList.toggle('hidden', isDefault)
			ctrlBar.querySelector('[data-show-if-default]')?.classList.toggle('hidden', !isDefault)
			ctrlBar.querySelector('[data-action="to-list"]')?.addEventListener('click', () => switchChannelType('list'))
			ctrlBar.querySelector('[data-action="set-default"]')?.addEventListener('click', () => setAsDefaultChannel())
			const privRow = ctrlBar.querySelector('[data-private-encryption-row]')
			const hiToggle = ctrlBar.querySelector('[data-high-privacy-toggle]')
			const encCap = ctrlBar.querySelector('[data-encryption-caption]')
			if (meta?.isPrivate && privRow && hiToggle instanceof HTMLInputElement) {
				privRow.classList.remove('hidden')
				/**
				 *
				 */
				const syncEncCaption = () => {
					if (!encCap) return
					const m = getLastChannelMeta()
					const mailbox = m?.encryptionScheme === 'mailbox-ecdh'
					encCap.textContent = geti18n(mailbox ? 'chat.group.channelEncryptionMailbox' : 'chat.group.channelEncryptionNone')
				}
				/**
				 *
				 */
				const syncEncUi = () => {
					const m = getLastChannelMeta()
					const mailbox = m?.encryptionScheme === 'mailbox-ecdh'
					hiToggle.checked = mailbox
					syncEncCaption()
				}
				if (encCap) setLocalizeLogic(encCap, syncEncCaption)
				syncEncUi()
				hiToggle.addEventListener('change', async () => {
					const wantsMailbox = hiToggle.checked
					const prevMailbox = getLastChannelMeta()?.encryptionScheme === 'mailbox-ecdh'
					if (wantsMailbox === prevMailbox) return
					const ok = wantsMailbox
						? confirm(geti18n('chat.group.channelEncryptionEnableWarning'))
						: confirm(geti18n('chat.group.channelEncryptionDisableWarning'))
					if (!ok) {
						hiToggle.checked = prevMailbox
						return
					}
					const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/common/${encodeURIComponent(channelId)}`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ encryptionScheme: wantsMailbox ? 'mailbox-ecdh' : 'none' }),
					})
					if (!r.ok) {
						hiToggle.checked = prevMailbox
						handleUIError(new Error(`encryption update HTTP ${r.status}`), 'chat.group.channelUpdateFailed', 'channel encryption update')
						return
					}
					if (reloadStateAndMessages)
						await reloadStateAndMessages()
					syncEncUi()
				})
				const cryptoRow = ctrlBar.querySelector('[data-channel-admin-crypto-row]')
				const cryptoBtn = ctrlBar.querySelector('[data-action="channel-crypto-migrate"]')
				if (cryptoRow && cryptoBtn) {
					/**
					 *
					 */
					const syncCryptoMigrateRow = async () => {
						if (!getLastChannelMeta()?.isPrivate) {
							cryptoRow.classList.add('hidden')
							return
						}
						try {
							const stR = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/state`)
							const st = stR.ok ? await stR.json() : null
							const allow = await viewerCanCryptoMigrate(st, groupId, channelId)
							cryptoRow.classList.toggle('hidden', !allow)
						}
						catch {
							cryptoRow.classList.add('hidden')
						}
					}
					await syncCryptoMigrateRow()
					cryptoBtn.addEventListener('click', async () => {
						const dlg = document.createElement('dialog')
						dlg.className = 'modal'
						const box = await renderTemplate('channel_crypto_migrate_modal', {})
						dlg.replaceChildren(box)
						document.body.appendChild(dlg)
						signal.addEventListener('abort', () => {
							if (dlg.isConnected) dlg.remove()
						}, { once: true })
						setLocalizeLogic(dlg, () => {
							for (const el of dlg.querySelectorAll('[data-i18n]')) {
								const k = el.getAttribute('data-i18n')
								if (k) el.textContent = geti18n(k)
							}
						})
						dlg.showModal()
						/**
						 *
						 */
						const close = () => {
							dlg.remove()
						}
						box.querySelector('[data-crypto-cancel]')?.addEventListener('click', close)
						box.querySelector('[data-crypto-confirm]')?.addEventListener('click', async () => {
							const sel = box.querySelector('[data-crypto-scheme]')
							const newScheme = sel instanceof HTMLSelectElement ? sel.value : 'aes-256-gcm'
							const m = getLastChannelMeta()
							const curV = m?.encryptionVersion
							const newVersion = typeof curV === 'number' && Number.isFinite(curV)
								? Math.max(1, Math.floor(curV) + 1)
								: 2
							try {
								const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/crypto-migrate`, {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ newScheme, newVersion }),
								})
								if (!r.ok) {
									handleUIError(new Error(`crypto-migrate HTTP ${r.status}`), 'chat.group.channelCryptoMigrateFailed', 'channel crypto-migrate')
									return
								}
								showToastI18n('success', 'chat.group.channelCryptoMigrateSuccess')
								close()
								if (reloadStateAndMessages)
									await reloadStateAndMessages()
								await syncCryptoMigrateRow()
								syncEncUi()
							}
							catch (e) {
								handleUIError(normalizeError(e), 'chat.group.channelCryptoMigrateFailed', 'channel crypto-migrate')
							}
						})
					})
				}
			}
			const localMentionCharNames = [...new Set(
				getMentionCharNames()
					.map(name => String(name || '').trim())
					.filter(name => !!name && name !== 'local')
			)]
			if (localMentionCharNames.length > 0) {
				const triggerWrap = document.createElement('div')
				triggerWrap.className = 'flex gap-1 items-center ml-auto flex-wrap'
				const label = document.createElement('span')
				label.className = 'text-xs opacity-50'
				setLocalizeLogic(label, () => {
					label.textContent = geti18n('chat.group.localAiLabel')
				})
				triggerWrap.appendChild(label)
				for (const charName of localMentionCharNames.slice(0, 5)) {
					const btn = document.createElement('button')
					btn.type = 'button'
					btn.className = 'btn btn-xs btn-outline btn-secondary'
					btn.textContent = `@${charName}`
					setLocalizeLogic(btn, () => {
						btn.title = geti18n('chat.group.forceTriggerOne', { name: charName })
					})
					btn.addEventListener('click', async () => {
						await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/chat/${encodeURIComponent(channelId)}/trigger-reply`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ charname: charName }),
						})
					})
					triggerWrap.appendChild(btn)
				}
				const allBtn = document.createElement('button')
				allBtn.type = 'button'
				allBtn.className = 'btn btn-xs btn-secondary inline-flex items-center gap-1'
				const flashIcon = document.createElement('img')
				flashIcon.src = 'https://api.iconify.design/mdi/flash.svg'
				flashIcon.className = 'w-4 h-4 shrink-0'
				flashIcon.alt = ''
				allBtn.appendChild(flashIcon)
				const allText = document.createElement('span')
				setLocalizeLogic(allText, () => {
					allText.textContent = geti18n('chat.group.forceTriggerAllLocal')
				})
				allBtn.appendChild(allText)
				setLocalizeLogic(allBtn, () => {
					allBtn.title = geti18n('chat.group.forceTriggerAllLocalTitle')
				})
				allBtn.addEventListener('click', async () => {
					for (const charName of localMentionCharNames)
						await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/chat/${encodeURIComponent(channelId)}/trigger-reply`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ charname: charName }),
						})
				})
				triggerWrap.appendChild(allBtn)
				ctrlBar.appendChild(triggerWrap)
			}
		}
		if (ctrlBar && (ctrlBar.innerHTML.trim() || ctrlBar.childElementCount))
			msgBox.appendChild(ctrlBar)

		const pinOrder = orderedActivePinTargets(messages)
		if (pinOrder.length) {
			const bar = document.createElement('div')
			bar.className = 'sticky top-0 z-10 bg-base-200/95 border border-base-300 rounded-lg px-2 py-2 mb-2 shadow-sm'
			const title = document.createElement('div')
			title.className = 'text-xs font-semibold opacity-80'
			title.dataset.i18n = 'chat.group.pinsBarTitle'
			bar.appendChild(title)
			const chips = document.createElement('div')
			chips.className = 'flex flex-wrap gap-1.5 mt-1.5'
			for (const tid of pinOrder) {
				const src = messages.find(x => x.eventId === tid)
				const preview = plainPreviewFromLine(src) || `${tid.slice(0, 8)}…`
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'btn btn-xs btn-ghost h-auto min-h-0 py-1.5 px-2 text-left max-w-[min(100%,20rem)] normal-case whitespace-normal'
				btn.textContent = preview
				btn.title = tid
				btn.addEventListener('click', () => {
					const el = msgBox.querySelector(`[data-event-anchor="${CSS.escape(tid)}"]`)
					el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
				})
				chips.appendChild(btn)
			}
			bar.appendChild(chips)
			msgBox.appendChild(bar)
		}

		state.msgScrollContainer = document.createElement('div')
		state.msgScrollContainer.className = 'flex-1 min-h-0 overflow-y-auto w-full'
		msgBox.appendChild(state.msgScrollContainer)

		state.msgVirtualList = createVirtualList({
			container: state.msgScrollContainer,
			/**
			 * @param {number} offset 偏移
			 * @param {number} limit 条数
			 * @returns {Promise<{ items: object[], total: number }>} 当前窗口切片与总数
			 */
			fetchData: async (offset, limit) => ({
				items: state.displayMessages.slice(offset, offset + limit),
				total: state.displayMessages.length,
			}),
			/**
			 * @param {object} item 消息项
			 * @param {number} index 索引
			 * @returns {HTMLElement} 单条消息根节点
			 */
			renderItem: (item, index) => renderMessageItem(item, index),
			initialIndex: Math.max(0, state.displayMessages.length - 1),
			/**
			 *
			 */
			onRenderComplete: () => {
				if (volHold && state.volatileStreamId) state.msgScrollContainer.appendChild(volHold)
				void attachLastMessageTimeline(state.displayMessages).catch(e => {
					Sentry.captureException(e)
					console.error('attachLastMessageTimeline failed:', e)
				})
				state.msgScrollContainer.scrollTop = state.msgScrollContainer.scrollHeight
			},
		})

		addDragAndDropSupport(state.msgScrollContainer, files => {
			for (const f of files) enqueuePendingFile(f)
		}, { signal })
	}

	return { loadMessages, scheduleMessagePatch }
}
