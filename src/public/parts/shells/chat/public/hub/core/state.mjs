/** Hub 页面共享可变状态（各子模块读写此对象字段）。 */
export const hubStore = {
	sidebar: {
		groups: [],
		/** 侧栏 Ctrl/Shift 多选中的群 ID */
		selectedGroupIds: new Set(),
		/** Shift 范围选择锚点群 ID */
		selectionAnchorGroupId: null,
		groupFoldersState: { folders: [] },
		/** 侧栏可见群 ID 顺序（与 `renderServerBar` 一致，供 Shift 多选） */
		sidebarGroupOrder: [],
		collapsedCategories: new Set(),
	},
	federation: {
		dagTips: [],
		/** 联邦同步横幅（由 setSyncBanner 写入，bindings 订阅） */
		syncBanner: { visible: false, i18nKey: 'chat.hub.banners.syncing', params: {} },
	},
	context: {
		currentMode: 'groups',
		currentGroupId: null,
		currentChannelId: null,
		currentState: null,
		fileHandlers: null,
	},
	messages: {
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
		channelOlderExhausted: false,
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
	},
	viewer: {
		/** 顶栏/侧栏展示名（非身份键） */
		viewerDisplayName: null,
		nodeHash: null,
		/** 登录用户 operator 实体（个人拉黑/隐藏列表归属；入群后不随 viewer 切换） */
		operatorEntityHash: null,
		viewerEntityHash: null,
	},
	/** `enterFriendChat` 进行中；`setMode('friends')` 时保留私聊会话 */
	friendChatEntering: false,
	/** 角色私聊或用户 DM；用户 DM 复用 `context.currentGroupId` 拉频道消息。 */
	privateGroup: {
		groupId: null,
		charname: null,
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

/** @type {Map<string, Set<(value: unknown) => void>>} */
const hubWatchers = new Map()

/** @type {Map<string, { parent: object, key: string, listener: (value: unknown) => void }[]>} */
const hubPathWatchers = new Map()

/**
 * @param {string} path 点分路径，如 `context.currentGroupId`
 * @returns {{ parent: object, key: string } | null} 父对象与末段键，或解析失败时 null
 */
function resolveHubPath(path) {
	const parts = String(path).split('.')
	if (!parts.length) return null
	let parent = hubStore
	for (let i = 0; i < parts.length - 1; i++) {
		const segment = parts[i]
		if (parent == null || typeof parent !== 'object' || !(segment in parent)) return null
		parent = parent[segment]
	}
	const key = parts[parts.length - 1]
	if (parent == null || typeof parent !== 'object' || !(key in parent)) return null
	return { parent, key }
}

/**
 * @param {string} path 点分路径
 * @returns {unknown} 当前字段值
 */
function getHubPathValue(path) {
	const resolved = resolveHubPath(path)
	if (!resolved) return undefined
	return resolved.parent[resolved.key]
}

/**
 * @param {string} path 点分路径
 * @param {unknown} value 新值
 * @returns {void}
 */
function setHubPathValue(path, value) {
	const resolved = resolveHubPath(path)
	if (!resolved) return
	if (resolved.parent[resolved.key] === value) return
	resolved.parent[resolved.key] = value
	const bucket = hubWatchers.get(path)
	if (bucket?.size)
		for (const listener of bucket) listener(value)
	const pathBucket = hubPathWatchers.get(path)
	if (pathBucket?.length)
		for (const entry of pathBucket)
			if (entry.parent[entry.key] === value) entry.listener(value)

}

/** 预注册常用字段订阅桶。 */
for (const path of [
	'context.currentGroupId',
	'context.currentChannelId',
	'context.currentState',
	'messages.focusedMessageEventId',
	'context.currentMode',
	'messages.channelSearchQuery',
	'messages.lastMessageId',
	'federation.syncBanner',
])
	hubWatchers.set(path, new Set())


/**
 * 订阅 Hub 嵌套字段（点分路径）。
 * @param {string} path 如 `context.currentGroupId`
 * @param {(value: unknown) => void} listener 变更回调
 * @returns {() => void} 取消订阅函数
 */
export function watchHubPath(path, listener) {
	const bucket = hubWatchers.get(path) ?? (() => {
		const created = new Set()
		hubWatchers.set(path, created)
		return created
	})()
	bucket.add(listener)
	return () => bucket.delete(listener)
}

/**
 * 订阅 Hub 关键字段（支持点分路径；旧扁平键名映射到嵌套路径）。
 * @param {string} key 字段名或点分路径
 * @param {(value: unknown) => void} listener 变更回调
 * @returns {() => void} 取消订阅函数
 */
export function watchHubState(key, listener) {
	const legacyMap = {
		currentGroupId: 'context.currentGroupId',
		currentChannelId: 'context.currentChannelId',
		currentState: 'context.currentState',
		focusedMessageEventId: 'messages.focusedMessageEventId',
	}
	const path = legacyMap[key] || key
	return watchHubPath(path, listener)
}

/**
 * 设置 Hub 字段并触发订阅回调（值未变化时不触发）。
 * @param {string} key 字段名或点分路径
 * @param {unknown} value 新值
 * @returns {void}
 */
export function setHubState(key, value) {
	const legacyMap = {
		currentGroupId: 'context.currentGroupId',
		currentChannelId: 'context.currentChannelId',
		currentState: 'context.currentState',
		focusedMessageEventId: 'messages.focusedMessageEventId',
	}
	const path = legacyMap[key] || key
	setHubPathValue(path, value)
}

/**
 * 读取 Hub 嵌套字段。
 * @param {string} path 点分路径
 * @returns {unknown} 当前字段值
 */
export function getHubState(path) {
	const legacyMap = {
		currentGroupId: 'context.currentGroupId',
		currentChannelId: 'context.currentChannelId',
		currentState: 'context.currentState',
		focusedMessageEventId: 'messages.focusedMessageEventId',
	}
	return getHubPathValue(legacyMap[path] || path)
}
