/**
 * MutationObserver 闸门：语种轮换 / 临时隐藏文案时不喂 a11y dirty。
 * 自持 observer；忽略期间 takeRecords 丢弃突变。
 */
import { markDirty } from './a11y.mjs'
import { markDirty as markCssvarDirty } from './cssvar.mjs'

let depth = 0

const observer = new MutationObserver(() => {
	if (depth > 0) return
	markDirty()
	markCssvarDirty()
})

/**
 * 开始观察 DOM。
 * @param {Node} target 观察根
 * @param {MutationObserverInit} init 观察选项
 * @returns {void}
 */
export function observe(target, init) {
	observer.observe(target, init)
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
		observer.takeRecords()
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
		observer.takeRecords()
		depth--
	}
}
