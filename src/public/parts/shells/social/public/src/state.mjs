/** Social 前端共享可变状态。 */
export const socialState = {
	viewerEntityHash: null,
	viewerDisplayName: null,
	/** @type {{ entityHash: string, charPartName?: string }[]} 本机 operator 拥有的 agent */
	agents: [],
	feedCursor: null,
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
