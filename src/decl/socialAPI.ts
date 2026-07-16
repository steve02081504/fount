/**
 * Social shell API 类型（与 `shells/social/src` 运行时对齐）。
 *
 * 时间线骨架字段见 `DAGEvent`（`p2pAPI.ts`）；群物化状态不在此文件。
 */

import type { DAGEvent, PersonalListsResponse } from './p2pAPI.ts'

/** 帖子可见范围：公开或仅关注者（followers 帖 GSH 加密）。 */
export type SocialVisibility = 'public' | 'followers'

/** 解密失败占位（`buildItem.withDecryptedPostContent`）。 */
export interface SocialDecryptView {
	failed: true
	pendingGeneration?: number
}

/** 帖文媒体引用（`groupEmoji`、vault 文件等）。 */
export interface SocialMediaRef {
	kind?: string
	groupId?: string
	emojiId?: string
	contentHash?: string
	shareId?: string
	owner?: string
	url?: string
	alt?: string
	[key: string]: unknown
}

/** 跨帖引用（回复 / 引用 / 群频道跳转）。 */
export interface SocialPostRef {
	entityHash: string
	postId: string
}

/**
 *
 */
export interface SocialGroupRef {
	groupId: string
	channelId?: string
}

/** 帖内投票草稿（`lib/poll.mjs::normalizePollDraft`）。 */
export interface SocialPollDraft {
	options: string[]
	multi: boolean
	deadline: string | null
}

/** 谁可回复本帖。 */
export type SocialReplyPolicy = 'everyone' | 'followers_7d' | 'author_follows'

/** 回复展示策略。 */
export type SocialReplyDisplay = 'all' | 'featured_only'

/** 时间线 `post` 事件的 content 载荷。 */
export interface SocialPostContent {
	text?: string
	mediaRefs?: SocialMediaRef[]
	replyTo?: SocialPostRef
	quoteRef?: SocialPostRef
	groupRef?: SocialGroupRef
	liveRef?: {
		entityHash: string
		liveId: string
		status?: 'live' | 'ended'
		startedAt?: number
		endedAt?: number
		duration?: number
		totalViewers?: number
		totalLikes?: number
		peakViewers?: number
	}
	lang?: string
	visibility?: SocialVisibility
	contentWarning?: string
	sensitiveMedia?: boolean
	poll?: SocialPollDraft
	tags?: string[]
	replyPolicy?: SocialReplyPolicy
	replyDisplay?: SocialReplyDisplay
}

/** `post_edit` 事件 content。 */
export interface SocialPostEditContent {
	targetPostId: string
	text?: string
	mediaRefs?: SocialMediaRef[]
	lang?: string
	contentWarning?: string
}

/** 探索/资料 meta（`social_meta` 物化字段，camelCase）。 */
export interface SocialMeta {
	exploreBlurb?: string
	hideFromDiscovery?: boolean
	createdAt?: number
	recoveryPubKeyHex?: string
	eventRetentionDepth?: number
	eventRetentionMs?: number
	compactTriggerEventDepth?: number
	[key: string]: unknown
}

/** 互动类事件共有 target 字段。 */
export interface SocialEngagementTarget {
	targetEntityHash: string
	targetPostId: string
}

/** `poll_vote` 事件 content。 */
export interface SocialPollVoteContent extends SocialEngagementTarget {
	choices: number[]
}

/**
 *
 */
export type SocialLikeContent = SocialEngagementTarget

/**
 *
 */
export interface SocialRepostContent extends SocialEngagementTarget {
	comment?: string
}

/**
 *
 */
export interface SocialFollowContent {
	targetEntityHash: string
}

/**
 *
 */
export interface SocialBlockContent {
	targetEntityHash: string
}

/**
 *
 */
export interface SocialPostDeleteContent {
	targetPostId: string
}

/** 时间线事件类型字面量（`SOCIAL_TIMELINE_REDUCERS` 键 + 保留类型）。 */
export type SocialTimelineEventType =
	| 'social_meta'
	| 'state_summary'
	| 'post'
	| 'post_edit'
	| 'post_delete'
	| 'poll_vote'
	| 'post_note'
	| 'note_vote'
	| 'like'
	| 'unlike'
	| 'dislike'
	| 'undislike'
	| 'tag_name'
	| 'repost'
	| 'follow'
	| 'unfollow'
	| 'tag_follow'
	| 'tag_unfollow'
	| 'reply_feature'
	| 'reply_unfeature'
	| 'live_start'
	| 'live_end'
	| 'follow_approve'
	| 'block'
	| 'unblock'
	| 'entity_key_rotate'
	| 'entity_key_revoke'
	| 'file_share'

/** 各事件 content 形状映射。 */
export interface SocialTimelineEventContentMap {
	social_meta: Partial<SocialMeta>
	state_summary: Record<string, unknown>
	post: SocialPostContent | Record<string, unknown>
	post_edit: SocialPostEditContent
	post_delete: SocialPostDeleteContent
	poll_vote: SocialPollVoteContent
	post_note: Record<string, unknown>
	note_vote: Record<string, unknown>
	like: SocialLikeContent
	unlike: SocialLikeContent
	dislike: SocialLikeContent
	undislike: SocialLikeContent
	tag_name: Record<string, unknown>
	repost: SocialRepostContent
	follow: SocialFollowContent
	unfollow: SocialFollowContent
	tag_follow: { tag: string }
	tag_unfollow: { tag: string }
	reply_feature: { targetPostId: string, replierEntityHash: string, replyPostId: string }
	reply_unfeature: { targetPostId: string, replierEntityHash: string, replyPostId: string }
	live_start: Record<string, unknown>
	live_end: { liveId: string }
	follow_approve: Record<string, unknown>
	block: SocialBlockContent
	unblock: SocialBlockContent
	entity_key_rotate: Record<string, unknown>
	entity_key_revoke: Record<string, unknown>
	file_share: Record<string, unknown>
}

/** 单条 Social 时间线 DAG 事件（判别联合）。 */
export type SocialTimelineEvent = {
	[K in SocialTimelineEventType]: Omit<DAGEvent, 'type' | 'content' | 'charId'> & {
		type: K
		content: SocialTimelineEventContentMap[K]
		charPartName?: string
	}
}[SocialTimelineEventType]

/** 物化后的帖子（含 postId 别名）。 */
export type SocialMaterializedPost = SocialTimelineEvent & { type: 'post', postId: string }

/** Feed / profile 作者摘要（`authorProfileSummary.mjs`）。 */
export interface SocialAuthorProfile {
	name?: string
	avatar?: string | null
}

/** 单条 feed 条目的互动计数（`createEngagementForPost`）。 */
export interface SocialFeedEngagement {
	likeCount: number
	repostCount: number
	replyCount: number
	viewerLiked: boolean
}

/** Feed 条目公共字段。 */
export interface SocialFeedItemBase extends SocialFeedEngagement {
	hlc: { wall: number, logical: number }
	authorProfile: SocialAuthorProfile | null
}

/** 原帖 feed 条目。 */
export interface SocialPostFeedItem extends SocialFeedItemBase {
	kind: 'post'
	entityHash: string
	postId: string
	post: SocialMaterializedPost & {
		content: SocialPostContent | null
		decryptView?: SocialDecryptView
	}
}

/** 转发 feed 条目（外层 postId 为 repost 事件 id）。 */
export interface SocialRepostFeedItem extends SocialFeedItemBase {
	kind: 'repost'
	entityHash: string
	postId: string
	post: SocialMaterializedPost
	targetEntityHash: string
	targetPostId: string
	repostComment: string
}

/**
 *
 */
export type SocialFeedItem = SocialPostFeedItem | SocialRepostFeedItem

/** `GET /feed` 等分页响应。 */
export interface SocialFeedPage {
	items: SocialFeedItem[]
	nextCursor: string | null
}

/** 通知类型（`notifications.mjs`）。 */
export type SocialNotificationType = 'reply' | 'mention' | 'like' | 'repost' | 'follow' | 'care_post' | 'poll_closed'

/** 聚合展示 actor 摘要。 */
export interface SocialNotificationActor {
	entityHash: string
	at: number
}

/** 通知条目固定 schema（读取层可返回聚合字段）。 */
export interface SocialNotificationItem {
	type: SocialNotificationType
	actorEntityHash: string
	postId: string | null
	targetPostId: string | null
	targetEntityHash?: string | null
	snippet?: string | null
	at: number
	actors?: SocialNotificationActor[]
	actorCount?: number
	latestActorEntityHash?: string | null
	aggregateKey?: string | null
}

/**
 *
 */
export interface SocialNotificationsPage {
	notifications: SocialNotificationItem[]
	nextCursor: string | null
	unreadCount: number
	viewerEntityHash: string | null
}

/** `GET …/profile/personal-lists` 与 chat `/api/parts/shells:chat/personal-lists` 共用。 */
export type SocialPersonalListsResponse = PersonalListsResponse

/** 关系写操作响应。 */
export interface SocialFollowResponse {
	entityHash: string
	isFollowing: boolean
}

/**
 *
 */
export interface SocialBlockResponse {
	entityHash: string
	blocked: boolean
}

/**
 *
 */
export interface SocialHideResponse {
	entityHash: string
	hidden: boolean
}

/** 本地收藏夹持久化结构。 */
export interface SavedPostsStore {
	folders: Record<string, { name: string, posts: Array<{ entityHash: string, postId: string }> }>
	unfiled: Array<{ entityHash: string, postId: string }>
}

/** 探索页账号摘要。 */
export interface SocialDiscoverAccount {
	entityHash: string
	name?: string
	exploreBlurb?: string
	avatarUrl?: string | null
}

/** 探索页帖子摘要。 */
export interface SocialDiscoverPost {
	entityHash: string
	postId: string
	textSnippet?: string
	mediaThumbs?: SocialMediaRef[]
	hlc: { wall: number, logical: number }
}

/** 联邦 RPC：请求/响应 type 分离（`SOCIAL_RPC_*_TYPES`）。 */
export interface SocialRpcDiscoverRequest {
	type: 'social_discover_request'
	n?: number
	cursor?: string
}

/**
 *
 */
export interface SocialRpcDiscoverResponse {
	type: 'social_discover_response'
	accounts: SocialDiscoverAccount[]
	nextCursor?: string | null
}

/**
 *
 */
export interface SocialRpcPostDiscoverRequest {
	type: 'social_post_discover_request'
	n?: number
	mediaOnly?: boolean
	cursor?: string
}

/**
 *
 */
export interface SocialRpcPostDiscoverResponse {
	type: 'social_post_discover_response'
	posts: SocialDiscoverPost[]
	nextCursor?: string | null
}

/** char.interfaces.social — 入站 post 事件（可序列化纯数据）。 */
export interface SocialMessageEvent {
	post: object
	authorEntityHash: string
	authorDisplayName: string
	postText: string
	replyTo?: SocialPostRef
	mentions: { entityHashes: string[] }
	viewerEntityHash: string
	username: string
	charPartName: string
	lang: string
}

/**
 *
 */
export interface SocialFollowEvent {
	username: string
	charPartName: string
	followerEntityHash: string
	followerUsername: string
	targetEntityHash: string
}

/**
 *
 */
export interface SocialCharInterface {
	OnMessage?: (event: SocialMessageEvent) => Promise<boolean>
	OnFollow?: (event: SocialFollowEvent) => Promise<void>
}
