/**
 * 聊天日志条目的运行时类型标记与谓词。
 *
 * 类型声明仍在 `src/decl/chatLog.ts`（fount 约定 `.ts` 只作 JSDoc 类型）；这里是实际逻辑，
 * 供 chat 引擎在运行时判定摘要 / 容器 / 问候条目。类型引用用 JSDoc `import('…/chatLog.ts')`。
 */
/** @typedef {import('../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */

/** 上下文压缩摘要条目的模型标记（同时用作条目 `name` 与 `type`）。 */
export const SUMMARY_ENTRY_TYPE = 'summary'

/**
 * 容器条目的模型标记：自身不贡献 chat log，只展开其 `logContextBefore` / `logContextAfter`。
 * 用于在轮次刷新时把已累积的追加上下文“封存”为一个锚点，保证后续新条目的时序正确。
 */
export const CONTAINER_ENTRY_TYPE = 'container'

/**
 * 问候条目的模型标记前缀：`type` 形如 `greeting:<subtype>`（subtype 为 `single` / `group` / `world_single` / `world_group`）。
 * 取代旧的 `extension.timeSlice.greeting_type`，使特殊条目统一由 `type` 判定。
 */
export const GREETING_ENTRY_TYPE = 'greeting'

/**
 * 由问候子类型构造条目的 `type` 值。
 * @param {string} subtype 问候子类型
 * @returns {string} `greeting:<subtype>`
 */
export function greetingEntryType(subtype) {
	return `${GREETING_ENTRY_TYPE}:${subtype}`
}

/**
 * 判断条目是否为摘要条目。
 * @param {chatLogEntry_t} entry 日志条目
 * @returns {boolean} 是否为摘要条目
 */
export function isSummaryEntry(entry) {
	return entry.type === SUMMARY_ENTRY_TYPE
}

/**
 * 判断条目是否为容器条目（自身不贡献 log，只展开前后追加内容）。
 * @param {chatLogEntry_t} entry 日志条目
 * @returns {boolean} 是否为容器条目
 */
export function isContainerEntry(entry) {
	return entry.type === CONTAINER_ENTRY_TYPE
}

/**
 * 判断条目是否为问候条目。
 * @param {chatLogEntry_t} entry 日志条目
 * @returns {entry is chatLogEntry_t & { type: string }} 是否为问候条目（`type` 形如 `greeting:<subtype>`）
 */
export function isGreetingEntry(entry) {
	return typeof entry?.type === 'string' && entry.type.startsWith(`${GREETING_ENTRY_TYPE}:`)
}

/**
 * 取问候条目的子类型。
 * @param {chatLogEntry_t} entry 日志条目
 * @returns {string | null} 子类型；非问候条目为 null
 */
export function greetingSubtypeOf(entry) {
	return isGreetingEntry(entry) ? entry.type.slice(GREETING_ENTRY_TYPE.length + 1) : null
}
