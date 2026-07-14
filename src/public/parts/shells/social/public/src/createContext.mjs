import { socialApi, viewerEntityHash } from './lib/apiClient.mjs'
import {
	authorLabel,
	formatTime as formatTimeWithI18n,
	renderAvatarHtml,
	renderMarkdown,
	renderQuoteBlockHtml as renderQuoteBlockHtmlWithI18n,
} from './lib/display.mjs'
import { createPostCardBuilder } from './postCard.mjs'
import { socialState } from './state.mjs'

/**
 * 创建 Social 前端应用上下文对象。
 * @param {(key: string, params?: object) => string} geti18n i18n
 * @returns {object} 应用上下文
 */
export function createSocialContext(geti18n) {
	const buildPostCard = createPostCardBuilder({
		/**
		 * 返回当前观看者 entityHash（恒为 operator）。
		 * @returns {string | null} 观看者 entityHash；未登录时为 null
		 */
		getViewerEntityHash: () => viewerEntityHash(),
		/**
		 * 本机 operator 拥有的 agent entityHash 集合。
		 * @returns {Set<string>} owned agent hashes
		 */
		getOwnedAgentEntityHashes: () => new Set(
			(socialState.agents || [])
				.map(row => String(row?.entityHash || '').trim().toLowerCase())
				.filter(Boolean),
		),
		geti18n,
		authorLabel,
		renderAvatarHtml,
		formatTime: formatTimeWithI18n,
		renderMarkdown,
		renderQuoteBlockHtml: renderQuoteBlockHtmlWithI18n,
	})

	/**
	 * 格式化为相对时间或本地化日期字符串。
	 * @param {number} [ts] 毫秒时间戳
	 * @returns {string} 相对时间
	 */
	const formatTime = ts => formatTimeWithI18n(geti18n, ts)

	/**
	 * 渲染引用原帖块 HTML。
	 * @param {{ entityHash: string, postId: string, text?: string }} quoteRef 引用
	 * @returns {string} HTML
	 */
	const renderQuoteBlockHtml = quoteRef => renderQuoteBlockHtmlWithI18n(geti18n, quoteRef)

	return {
		geti18n,
		state: socialState,
		socialApi,
		buildPostCard,
		authorLabel,
		renderAvatarHtml,
		formatTime,
		renderMarkdown,
		renderQuoteBlockHtml,
	}
}
