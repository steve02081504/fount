/**
 * Social shell API 类型（与 shells/social/src 对齐）。
 */

/** 帖子可见范围：公开或仅关注者。 */
export type SocialVisibility = 'public' | 'followers'

/** 时间线 post 事件的 content 载荷。 */
export interface SocialPostContent {
	text?: string
	mediaRefs?: Array<Record<string, unknown>>
	replyTo?: { entityHash: string, postId: string }
	quoteRef?: { entityHash: string, postId: string }
	groupRef?: { groupId: string, channelId?: string }
	lang?: string
	visibility?: SocialVisibility
	protected?: boolean
}

/** 签名后的 Social 时间线事件（post / follow / meta 等）。 */
export interface SocialTimelineEvent {
	id: string
	type: string
	groupId: string
	sender: string
	charId?: string
	timestamp: number
	hlc: { wall: number, logical: number }
	prev_event_ids: string[]
	content: SocialPostContent | Record<string, unknown>
	signature: string
}

/** 聚合 feed 中的单条帖子条目（含作者 entityHash 与 HLC 排序键）。 */
export interface SocialFeedItem {
	entityHash: string
	postId: string
	post: SocialTimelineEvent
	hlc: { wall: number, logical: number }
}

/** 本地收藏夹持久化结构（文件夹 + 未归档列表）。 */
export interface SavedPostsStore {
	folders: Record<string, { name: string, posts: Array<{ entityHash: string, postId: string }> }>
	unfiled: Array<{ entityHash: string, postId: string }>
}

/** 探索页展示的账号摘要。 */
export interface SocialDiscoverAccount {
	entityHash: string
	name?: string
	exploreBlurb?: string
	avatarUrl?: string | null
}

/** 探索页展示的帖子摘要。 */
export interface SocialDiscoverPost {
	entityHash: string
	postId: string
	textSnippet?: string
	mediaThumbs?: unknown[]
	hlc: { wall: number, logical: number }
}

/** 联邦 RPC：请求探索账号列表。 */
export interface SocialRpcDiscoverRequest {
	type: 'social_discover_request'
	n?: number
	cursor?: string
}

/** 联邦 RPC：探索账号列表响应。 */
export interface SocialRpcDiscoverResponse {
	type: 'social_discover_response'
	accounts: SocialDiscoverAccount[]
	nextCursor?: string | null
}

/** 联邦 RPC：请求探索帖子列表。 */
export interface SocialRpcPostDiscoverRequest {
	type: 'social_post_discover_request'
	n?: number
	mediaOnly?: boolean
	cursor?: string
}

/** 联邦 RPC：探索帖子列表响应。 */
export interface SocialRpcPostDiscoverResponse {
	type: 'social_post_discover_response'
	posts: SocialDiscoverPost[]
	nextCursor?: string | null
}

/** char.interfaces.social — 可选；未实现 OnMention 时默认走 chat.GetReply（类 bot）。 */
export interface SocialMentionEvent {
	username: string
	charPartName: string
	authorEntityHash: string
	authorDisplayName: string
	postId: string
	postText: string
	mentionedEntityHash: string
	replyTo: { entityHash: string, postId: string }
	lang: string
}

/** 本地 agent 收到新关注时的回调载荷。 */
export interface SocialFollowEvent {
	username: string
	charPartName: string
	followerEntityHash: string
	followerUsername: string
	targetEntityHash: string
}

/** 所关注实体发新帖时通知 OnFollowerUpdate 的载荷。 */
export interface SocialFollowerUpdateEvent {
	username: string
	charPartName: string
	authorEntityHash: string
	postId: string
	postText: string
	post: SocialTimelineEvent
	viewerUsername: string
}

/** 返回 null/undefined 表示跳过；string 为回复正文；{ text, skip? } 显式控制。 */
export type SocialHandlerResult = string | { text?: string, skip?: boolean } | null | undefined

/** char.interfaces.social 可选方法集合。 */
export interface SocialCharInterface {
	OnMention?: (event: SocialMentionEvent) => Promise<SocialHandlerResult>
	OnFollow?: (event: SocialFollowEvent) => Promise<void>
	OnFollowerUpdate?: (event: SocialFollowerUpdateEvent) => Promise<SocialHandlerResult>
}
