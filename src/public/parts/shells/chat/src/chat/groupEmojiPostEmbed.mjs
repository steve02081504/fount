import {
	registerGroupEmojiPostEmbedProvider,
	unregisterGroupEmojiPostEmbedProvider,
} from 'fount/scripts/p2p/group_emoji/post_embed_registry.mjs'

import { resolveGroupEmojiContent } from '../group/emojiContentResolve.mjs'
import { storeEmojiInCas } from '../group/groupEmojis.mjs'

const OWNER_ID = 'chat'

/** @returns {void} */
export function registerChatGroupEmojiPostEmbed() {
	registerGroupEmojiPostEmbedProvider(OWNER_ID, { resolveGroupEmojiContent, storeEmojiInCas })
}

/** @returns {void} */
export function unregisterChatGroupEmojiPostEmbed() {
	unregisterGroupEmojiPostEmbedProvider(OWNER_ID)
}
