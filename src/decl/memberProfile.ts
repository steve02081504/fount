/**
 * 群成员统一资料。chars 和 users 都是 member，信息存于此处。
 */
export interface MemberProfile_t {
	/** 成员 ID（全局唯一，user: username@host, char: charname@ownerUsername@host） */
	memberId: string
	/** 来源节点的 host */
	sourceHost: string
	/** 成员类型 */
	type: 'user' | 'char'
	/** 头像 URL */
	avatar?: string
	/** 简介（Chat Markdown） */
	bio?: string
	/** 状态（表情 + 一句话，格式如 "😊 在线"） */
	status?: string
	/** 资料页背景图 URL */
	background?: string
	/** 外部链接数组 */
	links?: MemberLink_t[]
	/** 仅 char：上下文长度限制（消息条数，超出范围的不进 chat_log） */
	contextLength?: number
	/** char 所属 user 的 username（展示 AI 发言时用于归属） */
	ownerUsername?: string
}

/**
 * 成员链接
 * @property {string} icon - 链接图标
 * @property {string} label - 链接标签
 * @property {string} url - 链接 URL
 */
export interface MemberLink_t {
	icon: string
	label: string
	url: string
}

/**
 * 群信息（公开可见，无需加群）
 */
export interface GroupPublicInfo_t {
	bio?: string
	icon?: string
	background?: string
	tags?: string[]
}

/**
 * 新型 Prompt 结构（多人场景）
 * public: 对所有人可见的 prompt
 * perMember: <memberId, prompt> 针对特定成员的 prompt
 */
export interface GroupPrompt_t {
	public: string
	perMember: Record<string, string>
}

/** world.getSpeakingOrder 单步：轮到某 char 回复，或轮到用户输入 */
export type MemberTurn_t =
	| { type: 'char'; memberId: string; requestOverride?: Record<string, unknown> }
	| { type: 'user' }

/** 发言顺序决策的上下文（world 可选实现） */
export interface SpeakingOrderContext_t {
	groupId: string
	channelId: string
	username: string
}
