import trustGraphTunables from './trust_graph.tunables.json' with { type: 'json' }
import { resolveFederationFanoutTopK } from './tunables_resolve.mjs'

/** @type {readonly string[]} 权限键注册表顺序（运算期 BigInt 编码用） */
export const PERMISSION_REGISTRY_ORDER = Object.freeze([
	'VIEW_CHANNEL',
	'SEND_MESSAGES',
	'SEND_STICKERS',
	'ADD_REACTIONS',
	'MANAGE_MESSAGES',
	'MANAGE_CHANNELS',
	'KICK_MEMBERS',
	'BAN_MEMBERS',
	'MANAGE_ROLES',
	'MANAGE_ADMINS',
	'INVITE_MEMBERS',
	'STREAM',
	'CREATE_THREADS',
	'UPLOAD_FILES',
	'MANAGE_FILES',
	'PIN_MESSAGES',
	'SET_WORLD',
	'ADMIN',
	'BYPASS_RATE_LIMIT',
])

/**
 * 默认晚消息冻结时间（毫秒）
 */
export const DEFAULT_LATE_MESSAGE_FREEZE_MS = 30_000
/**
 * 占位 `message` 无 `message_edit` 终稿时的空闲截断（毫秒）；§6.4 `streamGeneratingIdleMs` 默认。
 */
export const DEFAULT_STREAM_GENERATING_IDLE_MS = 150_000
/**
 * 默认最大捕获事件数
 */
export const DEFAULT_MAX_CATCHUP_EVENTS = 50_000
/**
 * 成员页面大小
 */
export const MEMBERS_PAGE_SIZE = 500
/** Checkpoint 中保留的 epoch 链历史条数上限 */
export const EPOCH_CHAIN_MAX = 256

/** 群文件经联邦复制的单块上限（字节，§10.2） */
export const FEDERATION_CHUNK_MAX_BYTES = trustGraphTunables.federationChunkMaxBytes

/** TrustGraph fanout 参考 Top-K（N=8 roster 时的缩放值；运行时请用 resolveFederationFanoutTopK） */
export const FEDERATION_FANOUT_TOP_K = resolveFederationFanoutTopK(8, trustGraphTunables)

/** 全局 fed_chunk_get miss 时 fanout 邻居数 */
export const FEDERATION_CHUNK_FETCH_FANOUT_K = trustGraphTunables.federationChunkFetchFanoutK
