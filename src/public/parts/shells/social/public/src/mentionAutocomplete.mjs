/**
 * Social 发帖框 @ 提及薄封装：共享组件 + 本地/关注候选。
 */
import { attachMentionAutocomplete as attachSharedMentionAutocomplete } from '/scripts/components/mentionAutocomplete.mjs'
import { getRegisteredMentionSuggest } from '/scripts/features/markdown/extensions.mjs'
import { aliasForEntity } from '/parts/shells:chat/shared/aliases.mjs'

import { suggestMentions } from './endpoints/mentions.mjs'

/**
 * 发帖框无群上下文。
 * @returns {object} 空上下文
 */
function socialMentionContext() {
	return {}
}

/**
 * 为发帖框挂载 @ 提及 autocomplete。
 * @param {HTMLTextAreaElement} textarea 发帖框
 * @returns {() => void} 卸载监听
 */
export function attachMentionAutocomplete(textarea) {
	return attachSharedMentionAutocomplete(textarea, {
		getContext: socialMentionContext,
		providers: [
			...getRegisteredMentionSuggest(),
			async (_ctx, query, limit) => {
				const data = await suggestMentions(query, limit)
				return (data.suggestions || []).map(row => ({
					...row,
					displayName: aliasForEntity(row.entityHash) || row.displayName,
				}))
			},
		],
		listboxPrefix: 'social-mention',
		emptyI18n: 'social.composer.mentionEmpty',
		accessibleLabelI18n: 'social.composer.mentionSuggest',
		trailingSpace: false,
	})
}
