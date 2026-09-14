/**
 * UI chrome emoji 检查：可见文案与 aria-label 不得出现 emoji。
 * 用户内容以 `user-content=""` / `language-check-ignore` 标记跳过（与语种扫描一致），
 * 命中即 `[test:emoji]` 控制台报错（Playwright 硬失败）。
 */
import { collectAriaLabelsForLocaleCheck, collectLeakingSelectors } from './locale_script.mjs'
import { wake } from './loop.mjs'
import { ignore } from './mutation_gate.mjs'
import { collectVisiblePageText } from './page_text.mjs'
import { createReporter } from './reporter.mjs'

const reporter = createReporter('[test:emoji]')

/** emoji 判定：默认 emoji 呈现，或带变体选择符的 pictographic（放过 ↔ ➡ ▸ 等文本呈现符号）。 */
const CHROME_EMOJI_RE = /[\p{Emoji_Presentation}]|[\p{Extended_Pictographic}]\uFE0F/gu

let dirty = true
let scanned = false

/**
 * 标记待扫（DOM 变化时由 mutations 调用）。
 * @returns {void}
 */
export function markDirty() {
	dirty = true
	wake()
}

/**
 * drain 覆盖：至少扫过一轮。
 * @returns {boolean} 是否已覆盖
 */
function covered() {
	return scanned
}

/**
 * @param {string} text 文本
 * @returns {string[]} 命中的去重 emoji 字符
 */
function findEmoji(text) {
	return [...new Set(String(text).match(CHROME_EMOJI_RE) || [])]
}

/**
 * loop 回调：有脏标记时扫描一轮。
 * @param {import('./loop.mjs').WatchTickContext} ctx tick 上下文
 * @returns {boolean} true = 空转
 */
function run({ draining }) {
	if (!dirty && !(draining && !scanned)) return true
	dirty = false

	for (const character of findEmoji(ignore(() => collectVisiblePageText())))
		reporter.report(
			`text\t${character}`,
			'text',
			character,
			collectLeakingSelectors(character).join(', ') || '(unknown)',
		)

	for (const { label, where } of ignore(() => collectAriaLabelsForLocaleCheck()))
		for (const character of findEmoji(label))
			reporter.report(`aria\t${character}\t${where}`, 'aria-label', where, character)

	scanned = true
	return false
}

/** @type {import('./loop.mjs').WatchTask} */
export const task = { name: 'emoji', delayMs: 500, run, covered }
