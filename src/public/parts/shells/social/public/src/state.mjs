/** Social 前端共享可变状态。 */
export const socialState = {
	viewerEntityHash: null,
	/** 本机 P2P nodeHash（分享链附带） */
	viewerNodeHash: null,
	viewerDisplayName: null,
	/** @type {{ name?: string, avatar?: string, infoDefaults?: { avatar?: string } } | null} */
	viewerProfile: null,
	feedCursor: null,
	/** @type {object[] | null} 已展示的 feed 原始条目（循环重放源） */
	feedShownItems: null,
	/** @type {{ cursor: string, items: object[], nextCursor: string | null } | null} */
	feedPrefetch: null,
	/** @type {Promise<void> | null} */
	feedPrefetchInFlight: null,
	profileEntityHash: null,
	/** @type {object | null} 当前资料页 socialMeta（设置弹窗用） */
	profileSocialMeta: null,
	profilePostsCursor: null,
	notificationsCursor: null,
	postDetailEntityHash: null,
	postDetailPostId: null,
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
