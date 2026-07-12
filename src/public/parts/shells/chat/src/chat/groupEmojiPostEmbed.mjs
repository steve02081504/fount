
import { resolveGroupEmojiContent } from '../group/emojiContentResolve.mjs'
import { storeEmojiInCas } from '../group/groupEmojis.mjs'

import {
	registerGroupEmojiPostEmbedProvider,
	unregisterGroupEmojiPostEmbedProvider,
} from './lib/groupEmojiPostEmbedRegistry.mjs'

const OWNER_ID = 'chat'

/** @returns {void} */
export function registerChatGroupEmojiPostEmbed() {
	registerGroupEmojiPostEmbedProvider(OWNER_ID, { resolveGroupEmojiContent, storeEmojiInCas })
}

/** @returns {void} */
export function unregisterChatGroupEmojiPostEmbed() {
	unregisterGroupEmojiPostEmbedProvider(OWNER_ID)
}
