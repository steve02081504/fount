/**
 * MutationObserver 忽略闸门：`ignore` / `ignoreAsync` 期间（depth > 0）丢弃突变，
 * 并在收尾 `takeRecords()` 清空队列，避免语种轮换 / 主题测量等刻意改动触发重扫。
 */
let depth = 0
/** 非忽略期的突变回调；由 mutations.mjs 注册（标记各 watch 任务脏）。 */
let onDirty = null
/** 惰性创建：Deno 纯逻辑测试无 MutationObserver，仅浏览器 observe 时初始化。 */
let observer = null

/**
 * 确保 MutationObserver 已创建并返回。
 * @returns {MutationObserver} observer
 */
function ensureObserver() {
	observer ??= new MutationObserver(() => {
		if (depth > 0) return
		onDirty?.()
	})
	return observer
}

/**
 * 注册非忽略期的突变回调。
 * @param {(() => void) | null} handler 回调
 * @returns {void}
 */
export function setDirtyHandler(handler) {
	onDirty = handler
}

/**
 * 开始观察 DOM。
 * @param {Node} target 观察根
 * @param {MutationObserverInit} init 观察选项
 * @returns {void}
 */
export function observe(target, init) {
	ensureObserver().observe(target, init)
}

/**
 * 同步忽略（pageText 隐藏语种扫描跳过节点）。
 * @template T
 * @param {() => T} fn 同步工作
 * @returns {T} fn 的返回值
 */
export function ignore(fn) {
	depth++
	try {
		return fn()
	}
	finally {
		observer?.takeRecords()
		depth--
	}
}

/**
 * 异步忽略（setLanguage / 脚本检查）。
 * @template T
 * @param {() => T | Promise<T>} fn 可能改 DOM 的工作
 * @returns {Promise<T>} fn 的返回值
 */
export async function ignoreAsync(fn) {
	depth++
	try {
		return await fn()
	}
	finally {
		observer?.takeRecords()
		depth--
	}
}
