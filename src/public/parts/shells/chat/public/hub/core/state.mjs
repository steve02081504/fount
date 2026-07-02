/** Hub 页面共享可变状态（各子模块读写此对象字段）。 */
export const hubStore = {
	// --- 群列表 / 侧栏 ---
	groups: [],
	/** 侧栏 Ctrl/Shift 多选中的群 ID */
	selectedGroupIds: new Set(),
	/** Shift 范围选择锚点群 ID */
	selectionAnchorGroupId: null,
	groupFoldersState: { folders: [] },
	/** 侧栏可见群 ID 顺序（与 `renderServerBar` 一致，供 Shift 多选） */
	sidebarGroupOrder: [],
	collapsedCategories: new Set(),

	// --- 联邦 / 同步 ---
	dagTips: [],
	/** 联邦同步横幅（由 setSyncBanner 写入，bindings 订阅） */
	syncBanner: { visible: false, i18nKey: 'chat.hub.banners.syncing', params: {} },

	// --- 当前群频道上下文 ---
	currentMode: 'groups',
	currentGroupId: null,
	currentChannelId: null,
	currentState: null,
	fileHandlers: null,

	// --- 消息管道 ---
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
	channelMessagePipeline: null,
	channelOlderExhausted: { value: false },
	/** 乐观发送中的 `pending:*` eventId；同时最多一条 */
	composerPendingId: null,
	/** @type {Map<string, { content: string, files?: File[] }>} 发送失败待重试载荷 */
	failedPendingPayloads: new Map(),
	/** 当前文本频道消息搜索关键词（小写）；null 表示未过滤 */
	channelSearchQuery: null,
	lastMessageId: null,
	/** 订阅后 Hub 消息列表滚动/高亮目标 eventId */
	focusedMessageEventId: null,
	/** 虚拟列表重建时的 scoped 滚动锚点 */
	pendingScrollTarget: null,

	// --- 查看者身份（operator 级 vs 当前群 viewer） ---
	/** 顶栏/侧栏展示名（非身份键） */
	viewerDisplayName: null,
	nodeHash: null,
	/** 登录用户 operator 实体（个人拉黑/隐藏列表归属；入群后不随 viewer 切换） */
	operatorEntityHash: null,
	viewerEntityHash: null,

	// --- 好友 / 角色私聊模式 ---
	/** `enterFriendChat` 进行中；`setMode('friends')` 时保留私聊会话 */
	friendChatEntering: false,
	/** 角色私聊或用户 DM；用户 DM 复用 `currentGroupId` 拉频道消息。 */
	privateGroup: {
		groupId: null,
		charName: null,
		/** 对端 128 位 entityHash（角色 agent / 用户统一） */
		peerEntityHash: null,
		channelId: 'default',
		refreshStopGenerationButton: null,
		enableComposer: null,
		disableComposer: null,
		scrollToBottom: null,
		applyAvatarsTo: null,
		onEnterPrivateGroup: null,
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
