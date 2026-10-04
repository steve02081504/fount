/**
 * 自包含的文件变化生产者：可在本机或分机会话上下文中初始化。
 * @param {{workdir: string, paths: string[]}} target 工作区及可见目录。
 * @param {object} callbackSession 通用会话上下文。
 * @returns {Promise<{count: number}>} 初始化结果。
 */
export async function startWorkspaceWatch(target, callbackSession) {
	const fs = await import('node:fs')
	const path = await import('node:path')
	// 工作区被删除/移动后 realpath 会抛 ENOENT；用固定文案让主机把它归为不可恢复的订阅失败，而不是无限重连
	const root = await fs.promises.realpath(target.workdir).catch(() => { throw new Error('Workspace unavailable') })
	const watchers = []
	let timer
	callbackSession.onDispose(() => { clearTimeout(timer); for (const watcher of watchers) watcher.close() })
	if (callbackSession.signal.aborted) return { count: 0 }
	const directories = new Set(['', ...target.paths])
	if (directories.size > 128) throw new Error('Too many watched directories')
	for (const relative of directories) {
		if (callbackSession.signal.aborted) break
		if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative && relative.replaceAll('\\', '/').split('/').some(segment => !segment || segment === '.' || segment === '..'))
			throw new Error('Invalid workspace-relative directory')
		let absolute
		try { absolute = await fs.promises.realpath(path.join(root, relative)) }
		catch { if (!relative) throw new Error('Workspace unavailable'); continue }
		const inside = path.relative(root, absolute)
		if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) throw new Error('Path escapes workspace')
		if (callbackSession.signal.aborted) break
		try {
			const watcher = fs.watch(absolute, () => {
				clearTimeout(timer)
				timer = setTimeout(() => callbackSession.emit({ type: 'change' }), 120)
			})
			watcher.on('error', () => callbackSession.close('watch-error'))
			watchers.push(watcher)
		}
		catch { if (!relative) throw new Error('Workspace watch unavailable') }
	}
	return { count: watchers.length }
}

/**
 * 把自包含生产者序列化为目标机器初始化脚本。
 * @param {object} target 工作区及目录列表。
 * @returns {any} 操作结果。
 */
export function workspaceWatchScript(target) {
	return `return await (${startWorkspaceWatch.toString()})(${JSON.stringify(target)}, callbackSession)`
}
