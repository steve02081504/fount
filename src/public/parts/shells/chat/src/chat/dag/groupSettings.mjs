/** §7.2 默认群设置（`defaultChannelId` 由建群时单独填入）。 */
export const DEFAULT_GROUP_SETTINGS = {
	joinPolicy: 'invite-only',
	powDifficulty: 4,
	fileSizeLimit: 10 * 1024 * 1024,
	fileQuotaBytes: 2 * 1024 * 1024 * 1024,
	fileUploadPolicy: 'all_members',
	fileReplicationFactor: 2,
	lateMessageFreezeMs: 30_000,
	streamGeneratingIdleMs: 150_000,
	hlcMaxSkewMs: 3_600_000,
	streamingSfuWss: null,
	maxDagPayloadBytes: 262_144,
	maxPeers: 24,
	trustedPeerSlots: 8,
	explorePeerSlots: 4,
	gossipTtl: 2,
	wantIdsBudget: 16,
	/** 静态信令频道分区数（含 sync 逻辑分区，至少 2） */
	federationPartitionCount: 8,
	rtcConnectionBudgetMax: 32,
	rtcJoinRatePerMin: 12,
	slashAlertTtl: 86_400_000,
	batterySaver: false,
	autoReplyFrequency: 0,
	eventRetentionDepth: 200_000,
	eventRetentionMs: 365 * 24 * 3600 * 1000,
	/** 0 = 不自动删除消息正文；>0 时按毫秒裁 `messages/*.jsonl` */
	messageContentRetentionMs: 0,
	compactTriggerEventDepth: 100_000,
	/** 热区：每频道保留时间最新的 N 帖 eventId */
	hotLatestMessageCount: 50,
	/** 每个 pin 保留 ±N 邻帖（按频道时间序） */
	pinContextMessageCount: 30,
	/** 仅当帖已冷归档后才允许从 DAG 删除 message */
	dagFoldAfterArchive: true,
	/** 关闭自动按时间裁 messages.jsonl */
	autoPruneMessagesJsonl: false,
	/** 关闭 retention 删除未归档 message */
	autoPruneDagMessages: false,
	messageRateLimitPerMin: 10,
	messageRateLimitWindowMs: 60_000,
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
	/** 是否在联邦发现 gossip 中公开此群（不含 roomSecret） */
	discoveryPublic: false,
	discoveryTitle: null,
	discoveryBlurb: null,
	/** 加群时自动进收藏的默认表情包；空则回落 packId===groupId */
	defaultEmojiPackId: null,
}

/**
 * 合并默认群设置（不做数值纠偏；非法字段由入站校验拒绝）。
 * @param {object} [raw] 原始群设置
 * @returns {object} 物化后的群设置
 */
export function materializeGroupSettings(raw = {}) {
	return { ...DEFAULT_GROUP_SETTINGS, ...raw }
}

/**
 * 校验 `group_settings_update` 补丁数值字段（入站拒绝非法值）。
 * @param {object} [content] 事件 content 补丁
 * @returns {void}
 */
export function validateGroupSettingsUpdateContent(content = {}) {
	if (content.maxDagPayloadBytes === undefined) return
	const maxDag = Number(content.maxDagPayloadBytes)
	if (!Number.isFinite(maxDag) || maxDag <= 0)
		throw new Error('group_settings_update: invalid maxDagPayloadBytes')
}
