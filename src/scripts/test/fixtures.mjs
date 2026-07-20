/**
 * 跨 shell 集成测试共用 fixture。
 */

/**
 * @param {string} [letter='x'] 重复字符
 * @returns {string} 128 字符占位 entityHash
 */
export function placeholderEntityHash(letter = 'x') {
	return letter.repeat(128)
}

/**
 * 惰性 async 单例，供 createTestSession 复用。
 * @template T
 * @param {() => Promise<T>} resolve 首次调用时解析并缓存会话
 * @returns {() => Promise<T>} 惰性会话 getter
 */
export function createLazySession(resolve) {
	let session = null
	return () => session ??= resolve()
}
