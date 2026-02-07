import fs from 'node:fs'

import { git } from '../scripts/git.mjs'
import { console } from '../scripts/i18n.mjs'

import { __dirname } from './base.mjs'
import idleManager from './idle.mjs'
import { restartor } from './server.mjs'
import { sendEventToAll } from './web_server/event_dispatcher.mjs'

/**
 * 当前的 Git 提交哈希。
 * @type {string|null}
 */
export let currentGitCommit = await git('rev-parse', 'HEAD').catch(() => null)

/**
 * 检查上游 git 存储库的更新，并在必要时重新启动应用程序。
 * @returns {Promise<void>}
 */
async function checkUpstreamAndRestart() {
	if (!fs.existsSync(__dirname + '/.git')) return
	try {
		await git('config', 'core.autocrlf', 'false')
		await git('fetch')

		if (!await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').catch(() => null)) return

		const remoteCommit = await git('rev-parse', '@{u}')

		if (currentGitCommit === remoteCommit) return
		const mergeBase = await git('merge-base', 'HEAD', '@{u}')
		if (mergeBase !== currentGitCommit) return // Not a fast-forward merge

		const changedFiles = await git('diff', '--name-only', 'HEAD', '@{u}').then(out => out.replace(/\\/g, '/').split('\n').filter(Boolean))
		const needsRestart = changedFiles.some(file =>
			file.endsWith('.mjs') && file.startsWith('src/') &&
			['decl', 'pages', 'locales'].every(dir => !file.startsWith(`src/${dir}/`)) &&
			!/^src\/public(?:\/[^/]+){2}\/public\//.test(file)
		)

		if (needsRestart) {
			console.logI18n('fountConsole.server.update.restarting')
			await restartor()
		}
		else {
			await git('reset', '--hard', '@{u}')
			currentGitCommit = await git('rev-parse', 'HEAD')
			sendEventToAll?.('server-updated', { commitId: currentGitCommit })
		}
	} catch (e) {
		console.errorI18n('fountConsole.partManager.git.updateFailed', { error: e })
	}
}

/**
 * 启用空闲时自动检查上游并重启（供 .noupdate 切换使用）。
 * @returns {void}
 */
export function enableAutoUpdate() {
	idleManager.onIdle(checkUpstreamAndRestart)
}

/**
 * 禁用空闲时自动检查上游并重启（供 .noupdate 切换使用）。
 * @returns {void}
 */
export function disableAutoUpdate() {
	idleManager.offIdle(checkUpstreamAndRestart)
}
