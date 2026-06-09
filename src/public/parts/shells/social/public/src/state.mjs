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
}

/** localStorage 键：通知已读水位（毫秒时间戳）。 */
export const NOTIFICATIONS_SEEN_KEY = 'social.notificationsSeenAt'
