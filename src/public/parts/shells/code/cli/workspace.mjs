import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * 选择显式工作区，或从调用目录向上查找最近的 Git 配置。
 * @param {string} cwd - 调用目录。
 * @param {string} [workspace] - 显式指定路径，跳过探测。
 * @returns {string} 工作区绝对路径；无 Git 配置时返回调用目录。
 */
export function resolveCodeWorkspace(cwd, workspace) {
	if (workspace) return resolve(cwd, workspace)
	const start = resolve(cwd)
	for (let candidate = start; ; candidate = dirname(candidate)) {
		try {
			if (statSync(join(candidate, '.git', 'config')).isFile()) return candidate
		}
		catch (error) {
			if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error
		}
		if (dirname(candidate) === candidate) return start
	}
}
