/** Social 前端共享可变状态。 */
export const socialState = {
	viewerEntityHash: null,
	feedCursor: null,
	profileEntityHash: null,
	pendingMediaRefs: [],
	pendingQuoteRef: null,
	pendingGroupRef: null,
	exploreMediaOnly: false,
	savedFoldersCache: {},
	pendingSave: null,
	activeFeedSearchQuery: null,
	/** 服务端通知已读水位（毫秒） */
	notificationsSeenAt: null,
	lastNotificationUnreadCount: 0,
}
