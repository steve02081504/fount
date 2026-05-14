import { join } from 'node:path'

import { getUserDictionary } from '../../../../../../server/auth.mjs'

/**
 * 聊天 shell 根目录：`{userDict}/shells/chat`
 * @param {string} username 本地账户名
 * @returns {string} 根目录绝对路径
 */
export function shellChatRoot(username) {
	return join(getUserDictionary(username), 'shells', 'chat')
}

/**
 * 单个群 / 会话在磁盘上的 DAG 数据目录。
 * @param {string} username 本地账户名
 * @param {string} chatId 群组或会话 ID
 * @returns {string} 群目录绝对路径
 */
export function chatDir(username, chatId) {
	return join(shellChatRoot(username), 'groups', chatId)
}

/**
 * DAG 事件流 JSONL 路径。
 * @param {string} username 本地账户名
 * @param {string} chatId 群组或会话 ID
 * @returns {string} `events.jsonl` 绝对路径
 */
export function eventsPath(username, chatId) {
	return join(chatDir(username, chatId), 'events.jsonl')
}

/**
 * 本地物化快照路径（§19 `snapshot.json`；非全网权威，仅加速恢复）。
 * @param {string} username 本地账户名
 * @param {string} chatId 群组或会话 ID
 * @returns {string} `snapshot.json` 绝对路径
 */
export function snapshotPath(username, chatId) {
	return join(chatDir(username, chatId), 'snapshot.json')
}

/**
 * 本地主观信誉表路径（§0.3；不进 DAG）。
 * @param {string} username 本地账户名
 * @param {string} chatId 群组 ID
 * @returns {string} `reputation.json` 绝对路径
 */
export function reputationPath(username, chatId) {
	return join(chatDir(username, chatId), 'reputation.json')
}

/**
 * PEX / 稀疏池线索（§7.2；本地 `peers.json`）。
 * @param {string} username 本地账户名
 * @param {string} chatId 群组 ID
 * @returns {string} `peers.json` 绝对路径
 */
export function peersPath(username, chatId) {
	return join(chatDir(username, chatId), 'peers.json')
}

/**
 * 频道消息派生日志 JSONL 路径。
 * @param {string} username 本地账户名
 * @param {string} chatId 群组或会话 ID
 * @param {string} channelId 频道 ID
 * @returns {string} 频道 JSONL 绝对路径
 */
export function messagesPath(username, chatId, channelId) {
	return join(chatDir(username, chatId), 'messages', `${channelId}.jsonl`)
}

/**
 * 会话元数据 JSON 所在目录：`{userDict}/shells/chat/chats`
 * @param {string} username 本地账户名
 * @returns {string} `chats` 目录绝对路径
 */
export function chatsRoot(username) {
	return join(shellChatRoot(username), 'chats')
}

/**
 * 单个会话的元数据 JSON 路径。
 * @param {string} username 本地账户名
 * @param {string} groupId 会话 / 群 ID
 * @returns {string} 元数据 JSON 绝对路径
 */
export function chatJsonPath(username, groupId) {
	return join(chatsRoot(username), `${groupId}.json`)
}

/**
 * 消息 logContext sidecar：`groups/{groupId}/context_cache/{channelId}/{messageId}.json`
 * @param {string} username 本地账户名
 * @param {string} groupId 会话 / 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} messageId 消息条目 ID
 * @returns {string} sidecar JSON 绝对路径
 */
export function sidecarPath(username, groupId, channelId, messageId) {
	return join(chatDir(username, groupId), 'context_cache', channelId, `${messageId}.json`)
}

/**
 * 群文件 AES 密钥侧车 JSON（不入 DAG）。
 * @param {string} username 本地账户名
 * @param {string} groupId 会话 / 群 ID
 * @returns {string} 密钥表 JSON 绝对路径
 */
export function aesKeysPath(username, groupId) {
	return join(chatDir(username, groupId), 'file_aes_keys.json')
}

/**
 * 本机 Ed25519 私钥种子文件路径（32 字节二进制，不入 DAG）。
 * @param {string} username 本地账户名
 * @param {string} groupId 会话 / 群 ID
 * @returns {string} 种子文件绝对路径
 */
export function localEd25519SeedPath(username, groupId) {
	return join(chatDir(username, groupId), 'local_ed25519_seed')
}
