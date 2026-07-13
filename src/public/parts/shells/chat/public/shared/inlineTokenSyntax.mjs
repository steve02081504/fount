/** Canonical inline token 格式（chat/social 共用）。 */

/**
 *
 */
export const EMOJI_TOKEN_RE = /:\[emoji:([\w.-]+)\/([\w.-]+)\]:/g

/**
 *
 */
export const MESSAGE_TOKEN_RE = /#\[message:([\w.-]+)\/([\w.-]+)\/([\w.-]+)\]/g
/**
 *
 */
export const CHANNEL_TOKEN_RE = /#\[channel:([\w.-]+)\/([\w.-]+)\]/g
/**
 *
 */
export const GROUP_TOKEN_RE = /#\[group:([\w.-]+)\]/g

/** 匹配顺序：@mention → #message → #channel → #group → :emoji: */
export const INLINE_TOKEN_RE = /@\[([^\]]+)\]|#\[message:([\w.-]+)\/([\w.-]+)\/([\w.-]+)\]|#\[channel:([\w.-]+)\/([\w.-]+)\]|#\[group:([\w.-]+)\]|:\[emoji:([\w.-]+)\/([\w.-]+)\]:/giu

/**
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {string} `:[emoji:groupId/emojiId]:`
 */
export function formatEmojiToken(groupId, emojiId) {
	return `:[emoji:${groupId}/${emojiId}]:`
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} `#[channel:groupId/channelId]`
 */
export function formatChannelToken(groupId, channelId) {
	return `#[channel:${groupId}/${channelId}]`
}

/**
 * @param {string} groupId 群 ID
 * @returns {string} `#[group:groupId]`
 */
export function formatGroupToken(groupId) {
	return `#[group:${groupId}]`
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} messageId 消息 event id
 * @returns {string} `#[message:groupId/channelId/messageId]`
 */
export function formatMessageToken(groupId, channelId, messageId) {
	return `#[message:${groupId}/${channelId}/${messageId}]`
}

/**
 * @param {string} entityHash 128-hex entity hash
 * @returns {string} `@[entity:entityHash]`
 */
export function formatEntityMentionToken(entityHash) {
	return `@[entity:${entityHash}]`
}

/**
 * @param {string} roleId `everyone` | `here` | 角色 id
 * @returns {string} `@[role:roleId]`
 */
export function formatRoleMentionToken(roleId) {
	return `@[role:${roleId}]`
}
