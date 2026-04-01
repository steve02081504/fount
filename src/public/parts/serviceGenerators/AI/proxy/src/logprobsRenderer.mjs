import { geti18nForLocales, localhostLocales } from '../../../../../../scripts/i18n.mjs'

/**
 * HTML 转义，防止 XSS。
 * @param {string} str - 待转义的字符串。
 * @returns {string} 转义后的安全字符串。
 */
const escapeHtml = (str) => String(str).replace(/["&'<>]/g, s => ({
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	'\'': '&#39;',
}[s]))

/**
 * 从 logprobs 构建带 tooltip 的 content_for_show  HTML。
 * NOTE: 为保持 token 布局会牺牲 markdown 渲染保真度。
 * @param {{content: string, extension?: any}} sourceResult - 原始响应结果（含 extension.logprobs）。
 * @param {{ useThemeStyles?: boolean, locales?: string[], supported_functions?: { fount_i18nkeys?: boolean } }} [renderOptions] - 渲染选项。
 * @returns {string} 带 logprobs 可视化样式的 HTML 字符串。
 */
export function buildContentForShowFromLogprobs(sourceResult, renderOptions = {}) {
	const items = sourceResult.extension?.logprobs?.content ?? []
	if (!items.length) return sourceResult.content
	const cleanContent = sourceResult.content || ''
	const tokenDecoder = new TextDecoder()
	const useThemeStyles = renderOptions.useThemeStyles ?? true
	const localeList = [...(renderOptions.locales ?? []), ...localhostLocales]
	const useFountI18nKeys = !!renderOptions.supported_functions?.fount_i18nkeys
	const naLabel = geti18nForLocales(localeList, 'chat.messageView.logprobsNotApplicable') ?? 'N/A'

	/**
	 * 从 logprob 条目提取 token 文本。
	 * @param {object} entry - logprob 条目（含 token 或 bytes）。
	 * @returns {string} token 文本。
	 */
	const tokenTextOf = (entry) => entry?.token ?? tokenDecoder.decode(Uint8Array.from(entry?.bytes ?? []))
	/**
	 * 将 logprob 转为百分比字符串。
	 * @param {number|null} logprob - 对数概率。
	 * @returns {string} 百分比字符串或本地化的「不适用」。
	 */
	const percentText = (logprob) => logprob == null ? naLabel : `${(Math.exp(logprob) * 100).toFixed(4)}%`
	/**
	 * 计算置信度 (0–1)。
	 * @param {number|null} logprob - 对数概率。
	 * @returns {number} 置信度。
	 */
	const confidenceOf = (logprob) => {
		if (logprob == null) return 0
		const p = Math.exp(logprob)
		return Math.max(0, Math.min(1, p))
	}
	/**
	 * 将置信度转换为百分比。
	 * @param {number|null} logprob - 对数概率。
	 * @returns {string} 0-100 的百分比字符串。
	 */
	const confidencePercent = (logprob) => (confidenceOf(logprob) * 100).toFixed(2)
	/**
	 * 将不可见字符替换为可见符号。
	 * @param {string} token - 原始 token 文本。
	 * @returns {string} 可读展示文本。
	 */
	const visibleToken = (token) => token
		.replace(/ /g, '␠')
		.replace(/\t/g, '⇥')
		.replace(/\n/g, '↵\n')
		.replace(/\r/g, '␍')

	/**
	 * top_logprobs 提示行（含模型 token，始终在服务端用插值生成，避免 data-i18n 动态参数的安全问题）。
	 * @param {string} tokenVisibleForHtml - 已按 HTML 文本转义、用于展示的 token（可见空白符形式）。
	 * @returns {string} 带 fount-logprob-meta 的 HTML 片段。
	 */
	const topLogprobsMetaHtml = (tokenVisibleForHtml) => {
		const raw = geti18nForLocales(localeList, 'chat.messageView.logprobsTopLogprobsMeta', {
			token: tokenVisibleForHtml,
		})
		const text = raw ?? `top_logprobs (selected: ${tokenVisibleForHtml})`
		return `<span class="fount-logprob-meta">${text}</span>`
	}

	/**
	 * 页脚指标行。服务端预填文案，支持 fount_i18nkeys 时附加 data-i18n + data-* 以便客户端语言切换时实时更新。
	 * @param {{ ttft: string, time: string, tokens: string, speed: string }} parts - 已格式化的片段。
	 * @returns {string} 页脚 span 的 HTML。
	 */
	const metricsFooterHtml = (parts) => {
		const raw = geti18nForLocales(localeList, 'chat.messageView.logprobsMetricsFooter', parts)
		const text = raw ?? `TTFT: ${parts.ttft} | Time: ${parts.time} | Tokens: ${parts.tokens} | Speed: ${parts.speed}`
		const i18nAttrs = useFountI18nKeys
			? ` data-i18n="chat.messageView.logprobsMetricsFooter" data-ttft="${escapeHtml(parts.ttft)}" data-time="${escapeHtml(parts.time)}" data-tokens="${escapeHtml(parts.tokens)}" data-speed="${escapeHtml(parts.speed)}"`
			: ''
		return /* html */ `<span class="fount-logprob-footer"${i18nAttrs}>${escapeHtml(text)}</span>`
	}

	const tokens = items.map(tokenTextOf)
	const rawJoined = tokens.join('')
	if (cleanContent && rawJoined && cleanContent !== rawJoined)
		return cleanContent

	const style = /* html */ `<style>
.fount-logprob-root{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;white-space:pre-wrap}
.fount-logprob-token{position:relative;display:inline;vertical-align:baseline;--fount-logprob-confidence-percent:50%;--err:${useThemeStyles ? 'var(--color-error, #ef4444)' : '#ef4444'};--ok:${useThemeStyles ? 'var(--color-success, #22c55e)' : '#22c55e'};--token-underline:color-mix(in oklab,var(--err) calc(100% - var(--fount-logprob-confidence-percent)),var(--ok) var(--fount-logprob-confidence-percent));border-bottom:2px solid var(--token-underline)}
.fount-logprob-token-value{white-space:pre;opacity:0.95}
.fount-logprob-token-tip{display:none;position:absolute;left:50%;top:-6px;transform:translate(-50%,-100%);z-index:9999;background:${useThemeStyles ? 'var(--color-base-100, #111)' : '#111'};color:${useThemeStyles ? 'var(--color-base-content, #fff)' : '#fff'};border:1px solid ${useThemeStyles ? 'color-mix(in oklab, var(--color-base-content, #fff) 16%, transparent)' : 'rgba(255,255,255,0.15)'};padding:6px 8px;border-radius:8px;max-width:360px;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;box-shadow:0 4px 18px rgba(0,0,0,0.35)}
.fount-logprob-token:hover .fount-logprob-token-tip{display:block}
.fount-logprob-token-tip .fount-logprob-meta{display:block;opacity:0.95;margin-bottom:4px}
.fount-logprob-token-tip .fount-logprob-cand{display:block;opacity:0.9}
.fount-logprob-token-tip .fount-logprob-line{display:grid;grid-template-columns:minmax(6ch,1fr) auto minmax(8ch,auto);column-gap:6px}
.fount-logprob-token-tip .fount-logprob-key{white-space:pre;overflow:hidden;text-overflow:ellipsis}
.fount-logprob-token-tip .fount-logprob-sep{text-align:center}
.fount-logprob-token-tip .fount-logprob-val{text-align:right}
.fount-logprob-token-tip .fount-logprob-chosen{font-weight:700;background:${useThemeStyles ? 'color-mix(in oklab, var(--color-base-content, #fff) 8%, transparent)' : 'rgba(255,255,255,0.08)'};border-radius:4px;padding-inline:2px}
.fount-logprob-footer{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;opacity:0.75;margin-top:6px;white-space:pre-wrap}
</style>`

	let htmlTokens = ''
	for (let i = 0; i < items.length; i++) {
		const item = items[i]
		const shownToken = tokens[i] ?? ''
		if (!shownToken) continue
		const shownTokenEsc = escapeHtml(shownToken)
		const shownTokenVisibleEsc = escapeHtml(visibleToken(shownToken))

		const candidates = item?.top_logprobs ?? []
		const candLines = []
		if (candidates.length)
			for (const cand of candidates) {
				const candToken = cand?.token ?? ''
				const probPercent = percentText(cand?.logprob)
				const candEsc = escapeHtml(visibleToken(candToken))
				const isChosen = candToken === shownToken
				candLines.push(
					/* html */ `<span class="fount-logprob-line ${isChosen ? 'fount-logprob-chosen' : ''}"><span class="fount-logprob-key">${candEsc}</span><span class="fount-logprob-sep">:</span><span class="fount-logprob-val">${probPercent}</span></span>`
				)
			}
		else {
			const selectedProb = percentText(item?.logprob)
			candLines.push(/* html */ `<span class="fount-logprob-line fount-logprob-chosen"><span class="fount-logprob-key">${shownTokenVisibleEsc}</span><span class="fount-logprob-sep">:</span><span class="fount-logprob-val">${selectedProb}</span></span>`)
		}
		const confidence = confidencePercent(item?.logprob)
		htmlTokens += /* html */ `<span class="fount-logprob-token" style="--fount-logprob-confidence-percent:${confidence}%"><span class="fount-logprob-token-value">${shownTokenEsc}</span><span class="fount-logprob-token-tip">${topLogprobsMetaHtml(shownTokenVisibleEsc)}<span class="fount-logprob-cand">${candLines.join('')}</span></span></span>`
	}
	if (!htmlTokens) return cleanContent

	const m = sourceResult.extension?.logprobs_metrics ?? {}
	const ttftRaw = m.ttftSeconds == null ? naLabel : `${m.ttftSeconds}s`
	const timeSeconds = m.timeSeconds ?? 0
	const tokensCount = m.tokensCount ?? 0
	const speed = m.speed ?? 0

	const footer = metricsFooterHtml({
		ttft: ttftRaw,
		time: `${timeSeconds.toFixed(2)}s`,
		tokens: String(tokensCount),
		speed: `${speed.toFixed(2)} tok/s`,
	})

	return `${style}<span class="fount-logprob-root">${htmlTokens}${footer}</span>`
}
