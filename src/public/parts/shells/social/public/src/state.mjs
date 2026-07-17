/** Social 前端共享可变状态。 */
export const socialState = {
	viewerEntityHash: null,
	viewerDisplayName: null,
	feedCursor: null,
	/** @type {object[] | null} 已展示的 feed 原始条目（循环重放源） */
	feedShownItems: null,
	/** @type {{ cursor: string, items: object[], nextCursor: string | null } | null} */
	feedPrefetch: null,
	/** @type {Promise<void> | null} */
	feedPrefetchInFlight: null,
	profileEntityHash: null,
	pendingMediaRefs: [],
	pendingQuoteRef: null,
	pendingGroupRef: null,
	pendingPoll: null,
	feedRanking: 'latest',
	feedSearchCursor: null,
	exploreMediaOnly: false,
	savedFoldersCache: {},
	pendingSave: null,
	activeFeedSearchQuery: null,
	/** 服务端通知已读水位（毫秒） */
	notificationsSeenAt: null,
	lastNotificationUnreadCount: 0,
	/** 收件箱 Tab：`all` | `mention` | `reply` | `like` | `follow` | `repost` */
	notificationsFilter: 'all',
}
