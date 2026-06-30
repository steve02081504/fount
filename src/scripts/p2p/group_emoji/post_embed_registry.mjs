/** @type {Map<string, { resolveGroupEmojiContent: (username: string, groupId: string, emojiId: string) => Promise<object | null>, storeEmojiInCas: (buffer: Buffer | Uint8Array) => Promise<string> }>} */
const providersByOwner = new Map()

/**
 * @param {string} ownerId 注册方
 * @param {{ resolveGroupEmojiContent: (username: string, groupId: string, emojiId: string) => Promise<object | null>, storeEmojiInCas: (buffer: Buffer | Uint8Array) => Promise<string> }} provider 解析器
 * @returns {void}
 */
export function registerGroupEmojiPostEmbedProvider(ownerId, provider) {
	providersByOwner.set(String(ownerId), provider)
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterGroupEmojiPostEmbedProvider(ownerId) {
	providersByOwner.delete(String(ownerId))
}

/**
 * @returns {{ resolveGroupEmojiContent?: (username: string, groupId: string, emojiId: string) => Promise<object | null>, storeEmojiInCas?: (buffer: Buffer | Uint8Array) => Promise<string> }}
 */
export function resolveGroupEmojiPostEmbedProvider() {
	for (const provider of providersByOwner.values())
		if (provider.resolveGroupEmojiContent && provider.storeEmojiInCas) return provider
	return {}
}
