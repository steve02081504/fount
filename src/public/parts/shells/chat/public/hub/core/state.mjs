/**
 * 【文件】public/hub/core/state.mjs
 * 【职责】Chat Hub 全局可变 store：群组/频道上下文、消息源、私聊、虚拟列表与搜索等跨模块共享字段（无 DOM 操作）。
 * 【原理】各 hub 子模块读写同一 hubStore 对象；currentGroupId/channelId 由 groupNav/hashNav 在导航时更新；
 *   channelMessagesSource（API 物化行）/channelMessagePipeline 供 messages 渲染。
 * 【数据结构】hubStore：groups、currentGroupId、currentChannelId、currentState、channelMessages、channelMessagePipeline、
 *   reactionRenderOpts、viewerEntityHash、privateGroup 等。
 * 【关联】被 hub 下几乎所有模块 import；与 urlHash、groupNav、messages、groupStream 协作。
 */
/** Hub 页面共享可变状态（各子模块读写此对象字段）。 */
export const hubStore = {
	groups: [],
	/** 侧栏 Ctrl/Shift 多选中的群 ID */
	selectedGroupIds: new Set(),
	/** Shift 范围选择锚点群 ID */
	selectionAnchorGroupId: null,
	groupFoldersState: { folders: [] },
	dagTips: [],
	/** 联邦同步横幅（由 setSyncBanner 写入，bindings 订阅） */
	syncBanner: { visible: false, i18nKey: 'chat.hub.banners.syncing', params: {} },
	fileHandlers: null,
	currentGroupId: null,
	currentChannelId: null,
	currentState: null,
	channelReactions: {},
	channelMessagesSource: [],
	channelMessages: [],
	reactionsEtag: '',
	reactionRenderOpts: {
		viewerMemberId: 'local',
		canAddReactions: false,
		canManageMessages: false,
		canPinMessages: false,
	},
	lastMessageId: null,
	/** 顶栏/侧栏展示名（非身份键） */
	viewerDisplayName: null,
	nodeHash: null,
	/** 登录用户 operator 实体（个人拉黑/隐藏列表归属；入群后不随 viewer 切换） */
	operatorEntityHash: null,
	viewerEntityHash: null,
	collapsedCategories: new Set(),
	currentMode: 'groups',
	/** `enterFriendChat` 进行中；`setMode('friends')` 时保留私聊会话 */
	friendChatEntering: false,
	/** 侧栏可见群 ID 顺序（与 `renderServerBar` 一致，供 Shift 多选） */
	sidebarGroupOrder: [],
	channelMessagePipeline: null,
	channelOlderExhausted: { value: false },
	/** 乐观发送中的 `pending:*` eventId；同时最多一条 */
	composerPendingId: null,
	/** @type {Map<string, { content: string, files?: File[] }>} 发送失败待重试载荷 */
	failedPendingPayloads: new Map(),
	/** 当前文本频道消息搜索关键词（小写）；null 表示未过滤 */
	channelSearchQuery: null,
	/** 订阅后 Hub 消息列表滚动/高亮目标 eventId */
	focusedMessageEventId: null,
	/** 虚拟列表重建时的 scoped 滚动锚点 */
	pendingScrollTarget: null,
	/** 好友私聊（角色或用户 DM）；角色时与联邦群 `currentGroupId` 互斥，用户 DM 时复用 `currentGroupId` 拉频道消息。 */
	privateGroup: {
		groupId: null,
		charName: null,
		/** 对端 128 位 entityHash（角色 agent / 用户统一） */
		peerEntityHash: null,
		channelId: 'default',
		refreshStopGenerationButton: null,
		/**
		 * 启用输入区（由 init 注入）。
		 * @returns {void}
		 */
		enableComposer: () => { },
		/**
		 * 禁用输入区（由 init 注入）。
		 * @returns {void}
		 */
		disableComposer: () => { },
		/**
		 * 滚动消息列表到底部（由 init 注入）。
		 * @returns {void}
		 */
		scrollToBottom: () => { },
		/**
		 * 为容器内头像元素应用最新 URL（由 init 注入）。
		 * @returns {void}
		 */
		applyAvatarsTo: () => { },
		/**
		 * 进入角色私聊 Hub 视图（由 init 注入）。
		 * @returns {void}
		 */
		onEnterPrivateGroup: () => { },
	},
}

/** @type {Map<'currentGroupId'|'currentChannelId'|'currentState'|'focusedMessageEventId', Set<(value: unknown) => void>>} */
const hubWatchers = new Map([
	['currentGroupId', new Set()],
	['currentChannelId', new Set()],
	['currentState', new Set()],
	['focusedMessageEventId', new Set()],
])

/**
 * 订阅 Hub 关键字段（试点：group/channel/state）。
 * @param {'currentGroupId'|'currentChannelId'|'currentState'|'focusedMessageEventId'} key 字段名
 * @param {(value: unknown) => void} listener 变更回调
 * @returns {() => void} 取消订阅
 */
export function watchHubState(key, listener) {
	const bucket = hubWatchers.get(key)
	if (!bucket) return () => { }
	bucket.add(listener)
	return () => bucket.delete(listener)
}

/**
 * 设置 Hub 关键字段并触发订阅回调（值未变化时不触发）。
 * @param {'currentGroupId'|'currentChannelId'|'currentState'|'focusedMessageEventId'} key 字段名
 * @param {unknown} value 新值
 * @returns {void}
 */
export function setHubState(key, value) {
	if (!(key in hubStore)) return
	if (hubStore[key] === value) return
	hubStore[key] = value
	const bucket = hubWatchers.get(key)
	if (!bucket?.size) return
	for (const listener of bucket) listener(value)
}
