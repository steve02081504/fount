import { normalizePartpath } from './part_invoke.mjs'

/** @type {Map<string, string>} shell 逻辑名 → partpath */
const shellPartpaths = new Map()

/**
 * Shell Load 时注册本 part 的 partpath（P2P 层不硬编码 shells/*）。
 * @param {string} shellKey 如 social、chat
 * @param {string} partpath 如 shells/social
 * @returns {void}
 */
export function registerShellPartpath(shellKey, partpath) {
	const key = String(shellKey || '').trim()
	const path = normalizePartpath(partpath)
	if (!key || !path) throw new Error('invalid_shell_partpath_registration')
	shellPartpaths.set(key, path)
}

/**
 * @param {string} shellKey 如 social、chat
 * @returns {void}
 */
export function unregisterShellPartpath(shellKey) {
	shellPartpaths.delete(String(shellKey || '').trim())
}

/**
 * @param {string} shellKey 如 social
 * @returns {string} 已注册的 partpath
 */
export function getShellPartpath(shellKey) {
	const path = shellPartpaths.get(String(shellKey || '').trim())
	if (!path) throw new Error(`shell partpath not registered: ${shellKey}`)
	return path
}
