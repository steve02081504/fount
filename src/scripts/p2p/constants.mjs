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
	'INVITE_MEMBERS',
	'STREAM',
	'CREATE_THREADS',
	'UPLOAD_FILES',
	'MANAGE_FILES',
	'PIN_MESSAGES',
	'SET_WORLD',
	'ADMIN',
])

/** 授权类 DAG 事件 type（用于物化状态增量折叠） */
export const AUTHZ_EVENT_TYPES = new Set([
	'member_join',
	'member_leave',
	'member_kick',
	'member_ban',
	'member_unban',
	'role_create',
	'role_update',
	'role_delete',
	'role_assign',
	'role_revoke',
	'channel_create',
	'channel_update',
	'channel_crypto_migrate',
	'channel_delete',
	'channel_permission_update',  // 频道级角色 allow/deny 覆写
	'list_item_update',
	'group_meta_update',
	'group_settings_update',
	'home_transfer',
	'encrypted_mailbox_batch',
	'owner_heartbeat',
	'file_upload',
	'file_delete',
	'owner_succession_ballot',
	'member_profile_update',
])

/**
 * 默认晚消息冻结时间（毫秒）
 */
export const DEFAULT_LATE_MESSAGE_FREEZE_MS = 30_000
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
