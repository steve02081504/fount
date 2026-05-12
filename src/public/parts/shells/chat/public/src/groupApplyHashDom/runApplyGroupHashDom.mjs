import * as Sentry from 'https://esm.sh/@sentry/browser'

import { showToastI18n } from '../../../../../../scripts/toast.mjs'
import {
	fetchMentionCharNames,
	preloadMemberAvatars,
	pullIncrementalDagEvents,
	saveActiveBranches,
} from '../groupApplyHashState.mjs'
import { createChannelView } from '../ui/channelView.mjs'
import { createFileHandlers } from '../ui/fileHandling.mjs'
import { createMentionPopover } from '../ui/mentionPopover.mjs'
import { createMessageInputHandlers } from '../ui/messageInput.mjs'
import { createMessageItemRenderer } from '../ui/messageItem.mjs'
import { createReactionHandlers } from '../ui/reactionUtils.mjs'
import { createThreadDrawer } from '../ui/threadDrawer.mjs'
import { handleUIError } from '../utils.mjs'

import { attachGroupInputDragDrop } from './attachGroupInputDragDrop.mjs'
import { loadGroupStateDom } from './loadGroupStateDom.mjs'
import { createGroupTypingIndicator } from './typingIndicator.mjs'

/**
 * @typedef {object} RunApplyGroupHashDomArgs
 * @property {HTMLElement} panel 群组主面板根节点
 * @property {HTMLElement} tree 频道树容器
 * @property {HTMLElement | null} members 成员列表容器（无则为 null）
 * @property {HTMLElement} msgBox 消息列表容器
 * @property {HTMLElement | null} input 消息输入框（无则为 null）
 * @property {AbortSignal} signal 中止信号（卸载时清理子视图与监听）
 * @property {string} groupId 群组 ID
 * @property {string} channelId 频道 ID
 * @property {string} wsClientId 客户端 WebSocket 身份 ID
 * @property {object} channelState `createChannelState` 返回的频道可变状态
 * @property {{
 *   lastChannels: Record<string, object>,
 *   lastChannelMeta: object | null,
 *   lastGroupSettings: object,
 *   openedChannels: Set<string>,
 *   memberAvatarCache: Map<string, string>,
 * }} stateSlice 跨频道 UI 切片（缓存、已打开频道等）
 * @property {() => unknown[]} getDmBlocklist 读取当前 DM 拉黑列表
 * @property {(next: unknown[]) => void} setDmBlocklist 覆盖 DM 拉黑列表
 */

/**
 * 挂载群组 DOM：频道树、成员、消息区、输入框，并组装 WebSocket 与输入处理器依赖。
 * @param {RunApplyGroupHashDomArgs} args 群组 UI 挂载参数
 * @returns {Promise<{ wsPayload: import('../groupApplyHashWs.mjs').ApplyGroupHashWsPayload, postMessage: Function, startAvSession: Function }>} WebSocket 载荷与消息/音视频处理器
 */
export async function runApplyGroupHashDom({
	panel,
	tree,
	members,
	msgBox,
	input,
	signal,
	groupId,
	channelId,
	wsClientId,
	channelState,
	stateSlice,
	getDmBlocklist,
	setDmBlocklist,
}) {
	const { openedChannels, memberAvatarCache } = stateSlice

	const { typingUsers, TYPING_TIMEOUT, updateTypingDisplay, sendTypingBroadcast } = createGroupTypingIndicator({
		groupId,
		channelId,
		wsClientId,
	})

	/** @type {string[]} */
	let mentionCharNames = []
	;(async () => {
		mentionCharNames = await fetchMentionCharNames(groupId)
	})()

	const { update: updateMentionPopover, hide: hideMentionPopover } = createMentionPopover(
		input,
		() => mentionCharNames,
		signal,
	)

	/**
	 * 批量预加载群成员头像到本地缓存（来自 members 分页 API，含 profile）。
	 * @returns {Promise<void>}
	 */
	async function preloadMemberAvatarsLocal() {
		await preloadMemberAvatars(groupId, memberAvatarCache, () => channelState.msgVirtualList?.refresh?.())
	}

	/**
	 * 返回最近一次 `loadState` 解析出的当前频道元数据。
	 * @returns {object | null} 当前频道在 `lastChannels` 中的 meta；未知时为 null
	 */
	function getLastChannelMeta() {
		return stateSlice.lastChannelMeta
	}

	/**
	 * 拉取群组状态并刷新频道树、成员列表与音视频面板（委托 `loadGroupStateDom`）。
	 * @returns {Promise<void>}
	 */
	const loadState = async () => {
		await loadGroupStateDom({
			groupId,
			channelId,
			tree,
			members,
			stateSlice,
		})
	}

	/**
	 * 判断某频道是否需要拉取完整消息（`channel` 同步范围仅在用户打开过该频道后加载）。
	 * @param {string} chId 频道 ID
	 * @returns {boolean} 需要加载消息时为 true
	 */
	const shouldLoadChannel = (chId) => {
		const { lastChannels } = stateSlice
		const { [chId]: meta } = lastChannels
		if (!meta || meta.syncScope !== 'channel') return true
		return openedChannels.has(chId)
	}

	/**
	 * 从 API 拉取书签列表并渲染到 `#group-bookmarks-list`。
	 * @returns {Promise<void>}
	 */
	const loadBookmarks = async () => {
		const el = document.getElementById('group-bookmarks-list')
		if (!el) return
		const r = await fetch('/api/parts/shells:chat/bookmarks')
		if (!r.ok) {
			Sentry.captureException(new Error(`loadBookmarks HTTP ${r.status}`))
			console.error('loadBookmarks failed:', r.status)
			const placeholderLi = document.createElement('li')
			placeholderLi.className = 'text-xs opacity-50'
			placeholderLi.textContent = '—'
			el.replaceChildren(placeholderLi)
			return
		}
		const raw = await r.json()
		const list = Array.isArray(raw) ? raw : []
		el.innerHTML = ''
		for (const e of list) {
			if (!e.groupId || !e.channelId) continue
			const li = document.createElement('li')
			const a = document.createElement('a')
			a.className = 'truncate'
			a.href = e.href || `#${e.groupId}:${e.channelId}`
			a.textContent = e.title || `${e.groupId.slice(0, 10)}… / ${e.channelId}`
			li.appendChild(a)
			el.appendChild(li)
		}
		if (!el.children.length) {
			const placeholderLi = document.createElement('li')
			placeholderLi.className = 'text-xs opacity-50'
			placeholderLi.textContent = '—'
			el.replaceChildren(placeholderLi)
		}
	}

	let loadMessages, scheduleMessagePatch

	const { uploadGroupFile, downloadGroupFile, fetchGroupFileAsBlob, enqueuePendingFile, pendingFiles } = createFileHandlers({
		groupId, showToastI18n,
		/**
		 * 重新加载当前频道消息（文件处理完成后刷新列表）。
		 * @returns {Promise<void>} 重新加载完成时 resolve
		 */
		loadMessages: () => loadMessages(),
	})

	const { toggleReaction } = createReactionHandlers({ groupId, channelId })

	/** @type {{ open: Function, close: Function, destroy: Function } | null} */
	let threadDrawerInstance = null

	const { renderMessageItem, attachLastMessageTimeline } = createMessageItemRenderer({
		groupId,
		channelId,
		msgBox,
		/**
		 * 重新加载当前频道消息（编辑、反应、线程等操作后刷新）。
		 * @returns {Promise<void>} 重新加载流程完成时 resolve
		 */
		loadMessages: () => loadMessages(),
		/**
		 * 当前用于渲染的展示消息数组。
		 * @returns {unknown[]} 与 `channelState.displayMessages` 同步的展示消息
		 */
		getDisplayMessages: () => channelState.displayMessages,
		/**
		 * 成员头像缓存（pubKeyHash / memberId / 名 等键）。
		 * @returns {Map<string, string>} 成员键到头像 URL 的映射
		 */
		getMemberAvatarCache: () => memberAvatarCache,
		toggleReaction,
		fetchGroupFileAsBlob,
		downloadGroupFile,
		loadBookmarks,
		getDmBlocklist,
		setDmBlocklist,
		/**
		 * 已编辑过的消息条目 ID 集合（用于展示 “已编辑” 状态）。
		 * @returns {Set<string>} 已编辑过的 chatLogEntryId 集合
		 */
		getEditedIds: () => {
			const s = new Set()
			for (const m of channelState.rawMessages)
				if (m.type === 'message_edit' && m.content?.chatLogEntryId)
					s.add(String(m.content.chatLogEntryId))

			return s
		},
		/**
		 * 消息内容高度变化时，若用户接近底部则保持贴底滚动。
		 * @returns {void} 无返回值
		 */
		onContentResize: () => {
			const { msgScrollContainer } = channelState
			if (!msgScrollContainer) return
			const { scrollHeight, scrollTop, clientHeight } = msgScrollContainer
			const distFromBottom = scrollHeight - scrollTop - clientHeight
			if (distFromBottom < 200)
				msgScrollContainer.scrollTop = scrollHeight
		},
		/**
		 * 打开指定频道 ID 的线程侧栏。
		 * @param {string} threadChannelId 线程频道 ID
		 * @returns {void} 无返回值
		 */
		onOpenThread: threadChannelId => {
			const rootTitle = stateSlice.lastChannels[channelId]?.title || channelId
			threadDrawerInstance?.open(threadChannelId, rootTitle, { fresh: true })
		},
		/**
		 * 分支 DAG 元信息映射（用于消息时间线分支 UI）。
		 * @returns {Map<string, unknown>} 分支键到元信息的映射
		 */
		getBranchInfo: () => channelState.branchInfo,
		/**
		 * 用户在分支点选择了某条事件后，持久化并刷新消息列表。
		 * @param {string} branchKey 分支键（父消息/事件标识）
		 * @param {string} selectedEventId 选中的事件 ID
		 * @returns {void} 无返回值
		 */
		onBranchSelect: (branchKey, selectedEventId) => {
			channelState.activeBranches.set(branchKey, selectedEventId)
			saveActiveBranches(groupId, channelId, channelState.activeBranches)
			void loadMessages()
		},
	})

	/**
	 * 为线程抽屉创建与主列表类似的消息项渲染器（独立 `channelId` / 容器）。
	 * @param {object} opts 线程渲染参数
	 * @param {string} opts.channelId 线程频道 ID
	 * @param {HTMLElement} opts.msgBox 线程消息容器
	 * @param {() => Promise<void>} opts.loadMessages 加载该线程消息的函数
	 * @returns {ReturnType<typeof createMessageItemRenderer>} 与 `createMessageItemRenderer` 相同形态的渲染器 API
	 */
	const createThreadRenderer = ({ channelId: threadChannelId, msgBox: threadMsgBox, loadMessages: threadLoadMessages }) =>
		createMessageItemRenderer({
			groupId,
			channelId: threadChannelId,
			msgBox: threadMsgBox,
			loadMessages: threadLoadMessages,
			/**
			 * 线程视图下由 `loadMessages` 填充；此处占位为空数组。
			 * @returns {unknown[]} 线程消息占位（空）
			 */
			getDisplayMessages: () => [],
			/**
			 * 与主频道共享成员头像缓存。
			 * @returns {Map<string, string>} 成员键到头像 URL 的映射
			 */
			getMemberAvatarCache: () => memberAvatarCache,
			toggleReaction,
			fetchGroupFileAsBlob,
			downloadGroupFile,
			loadBookmarks,
			getDmBlocklist,
			setDmBlocklist,
			/**
			 * 线程内嵌渲染不追踪编辑集合（空 Set）。
			 * @returns {Set<string>} 空集合
			 */
			getEditedIds: () => new Set(),
			/**
			 * 线程抽屉内不自动滚动主列表。
			 * @returns {void} 无返回值
			 */
			onContentResize: () => {},
			/**
			 * 打开嵌套子线程时复用同一抽屉实例。
			 * @param {string} nestedThreadId 子线程频道 ID
			 * @param {string} [nestedTitle] 子线程展示标题
			 * @returns {void} 无返回值
			 */
			onOpenThread: (nestedThreadId, nestedTitle) => {
				threadDrawerInstance?.open(nestedThreadId, nestedTitle, { fresh: false })
			},
		})

	threadDrawerInstance = createThreadDrawer({
		groupId,
		panel,
		createThreadRenderer,
	})

	signal.addEventListener('abort', () => {
		threadDrawerInstance?.destroy()
		threadDrawerInstance = null
	})

	/**
	 * 将当前频道类型更新为服务端给定类型，并可同时设为群组默认频道。
	 * @param {string} newType 目标频道类型（如 list / streaming 等）
	 * @param {boolean} [setAsDefault=false] 是否同时设为默认频道
	 * @returns {Promise<void>} 更新完成并已刷新 state/messages 时 resolve
	 */
	const switchChannelType = async (newType, setAsDefault = false) => {
		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: newType }),
		})
		if (!r.ok) {
			handleUIError(new Error(`switchChannelType HTTP ${r.status}`), 'chat.group.channelUpdateFailed', 'switchChannelType')
			return
		}
		if (setAsDefault) {
			const r2 = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/default-channel`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ channelId }),
			})
			if (r2.ok)
				showToastI18n('success', 'chat.group.defaultChannelSet')
		}
		await loadState()
		await loadMessages()
	}

	/**
	 * 将当前频道设为群组默认进入频道。
	 * @returns {Promise<void>} 请求完成并已刷新 state 时 resolve
	 */
	const setAsDefaultChannel = async () => {
		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/default-channel`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ channelId }),
		})
		if (r.ok)
			showToastI18n('success', 'chat.group.defaultChannelSet')
		else
			handleUIError(new Error(`setAsDefaultChannel HTTP ${r.status}`), 'chat.group.defaultChannelSetFailed', 'setAsDefaultChannel')
		await loadState()
	}

	/** @type {() => Promise<void>} 由 `createChannelView` 赋值，用于 `reloadStateAndMessages` */
	let runLoadMessages = async () => {}
	/**
	 * 先刷新频道树与设置，再重新加载消息列表。
	 * @returns {Promise<void>} `loadState` 与 `runLoadMessages` 均完成后 resolve
	 */
	const reloadStateAndMessages = async () => {
		await loadState()
		await runLoadMessages()
	}

	;({ loadMessages, scheduleMessagePatch } = createChannelView({
		groupId,
		channelId,
		msgBox,
		input,
		signal,
		state: channelState,
		getLastChannelMeta,
		/**
		 * 最近一次 `loadState` 解析出的群组设置（默认频道等）。
		 * @returns {object} `stateSlice.lastGroupSettings`
		 */
		getLastGroupSettings: () => stateSlice.lastGroupSettings,
		/**
		 * 当前用于 @mention 补全的角色名列表。
		 * @returns {string[]} 角色名数组快照
		 */
		getMentionCharNames: () => mentionCharNames,
		/**
		 * 用户在本会话中已打开过的频道 ID 集合（影响 `shouldLoadChannel`）。
		 * @returns {Set<string>} 已打开频道 ID 集合
		 */
		getOpenedChannels: () => openedChannels,
		enqueuePendingFile,
		switchChannelType,
		setAsDefaultChannel,
		reloadStateAndMessages,
		renderMessageItem,
		attachLastMessageTimeline,
		/**
		 * 各分支点当前选中的事件 ID（用于 DAG 消息时间线）。
		 * @returns {Map<string, string>} 分支点到选中 eventId 的映射
		 */
		getActiveBranches: () => channelState.activeBranches,
	}))
	runLoadMessages = loadMessages

	await pullIncrementalDagEvents(groupId)
	await loadState()
	void preloadMemberAvatarsLocal()
	await loadBookmarks()
	await loadMessages()

	attachGroupInputDragDrop(input, { enqueuePendingFile, signal })

	const wsPayload = {
		groupId,
		channelId,
		wsClientId,
		channelState,
		scheduleMessagePatch,
		memberAvatarCache,
		typingUsers,
		TYPING_TIMEOUT,
		updateTypingDisplay,
		loadMessages,
		loadState,
		loadBookmarks,
		shouldLoadChannel,
		msgBox,
	}

	const { postMessage, startAvSession } = createMessageInputHandlers({
		groupId,
		channelId,
		signal,
		input,
		wsClientId,
		/**
		 * 待发送的文件队列（拖拽/选择后暂存）。
		 * @returns {unknown[]} 与内部 `pendingFiles` 同步的队列引用
		 */
		getPendingFiles: () => pendingFiles,
		/**
		 * 清空待发送文件队列。
		 * @returns {void} 无返回值
		 */
		clearPendingFiles: () => { pendingFiles.length = 0 },
		enqueuePendingFile,
		uploadGroupFile,
		/**
		 * 当前音视频会话对象（若未开始则为 null）。
		 * @returns {unknown | null} 当前会话或 null
		 */
		getAvSession: () => channelState.avSession,
		/**
		 * 设置或清除当前音视频会话引用。
		 * @param {unknown | null} s 新会话对象或 null
		 * @returns {void} 无返回值
		 */
		setAvSession: s => { channelState.avSession = s },
		getLastChannelMeta,
		/**
		 * 最近一次 `loadState` 解析出的频道树（id → meta）。
		 * @returns {Record<string, object>} 频道 ID 到 meta 的记录
		 */
		getLastChannels: () => stateSlice.lastChannels,
		loadMessages,
		loadBookmarks,
		loadState,
		hideMentionPopover,
		updateMentionPopover,
		sendTypingBroadcast,
	})

	return { wsPayload, postMessage, startAvSession }
}
