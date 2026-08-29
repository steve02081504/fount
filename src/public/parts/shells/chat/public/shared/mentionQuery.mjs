/** 解析光标处正在输入的 @ 提及片段（chat hub / social 共用）。 */

/**
 * 在给定文本与光标位置处解析当前 @ 提及片段。
 * 支持 `@query` 与 `@[query]` 两种形态；已补全的 token（query 含 `:`，如 `entity:…` / `role:…`）不视为进行中的查询。
 * @param {string} text 输入框全文（fount 文本）
 * @param {number} caretPos 光标偏移（文本码位位置）
 * @returns {{ query: string, start: number, end: number } | null} 进行中的 @ 片段；无则为 null
 */
export function currentMentionQuery(text, caretPos) {
	const before = text.slice(0, caretPos)
	const match = before.match(/@(?:\[([^\]]*)\]|([^\s@[\]]*))?$/u)
	if (!match) return null
	const query = match[1] ?? match[2] ?? ''
	if (query.includes(':')) return null
	return {
		query,
		start: caretPos - match[0].length,
		end: caretPos,
	}
}
