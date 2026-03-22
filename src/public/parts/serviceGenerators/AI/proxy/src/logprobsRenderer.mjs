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
 * @param {{ useThemeStyles?: boolean }} [renderOptions] - 渲染选项。
 * @returns {string} 带 logprobs 可视化样式的 HTML 字符串。
 */
export function buildContentForShowFromLogprobs(sourceResult, renderOptions = {}) {
	const items = sourceResult.extension?.logprobs?.content ?? []
	if (!items.length) return sourceResult.content
	const cleanContent = sourceResult.content || ''
	const tokenDecoder = new TextDecoder()
	const useThemeStyles = renderOptions.useThemeStyles ?? true

	/**
	 * 从 logprob 条目提取 token 文本。
	 * @param {object} entry - logprob 条目（含 token 或 bytes）。
	 * @returns {string} token 文本。
	 */
	const tokenTextOf = (entry) => entry?.token ?? tokenDecoder.decode(Uint8Array.from(entry?.bytes ?? []))
	/**
	 * 将 logprob 转为百分比字符串。
	 * @param {number|null} logprob - 对数概率。
	 * @returns {string} 百分比字符串或 'N/A'。
	 */
	const percentText = (logprob) => logprob == null ? 'N/A' : `${(Math.exp(logprob) * 100).toFixed(4)}%`
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
		htmlTokens += /* html */ `<span class="fount-logprob-token" style="--fount-logprob-confidence-percent:${confidence}%"><span class="fount-logprob-token-value">${shownTokenEsc}</span><span class="fount-logprob-token-tip"><span class="fount-logprob-meta">top_logprobs (selected: ${shownTokenVisibleEsc})</span><span class="fount-logprob-cand">${candLines.join('')}</span></span></span>`
	}
	if (!htmlTokens) return cleanContent

	const m = sourceResult.extension?.proxy_data?.logprobs_metrics ?? {}
	const ttft = m.ttftSeconds == null ? 'N/A' : `${m.ttftSeconds}s`
	const timeSeconds = m.timeSeconds ?? 0
	const tokensCount = m.tokensCount ?? 0
	const speed = m.speed ?? 0

	const footer = /* html */ `<span class="fount-logprob-footer">TTFT: ${ttft} | Time: ${timeSeconds.toFixed(2)}s | Tokens: ${tokensCount} | Speed: ${speed.toFixed(2)} tok/s</span>`

	return `${style}<span class="fount-logprob-root">${htmlTokens}${footer}</span>`
}
