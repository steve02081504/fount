import { getGlobalConsoleResolver } from 'npm:@steve02081504/virtual-console/node'
import { createLogWireWebSocketHandler } from 'npm:@steve02081504/virtual-console/wire/server'
import { on_shutdown } from 'npm:on-shutdown'

import { geti18nForTerminal } from '../../../scripts/i18n/index.mjs'
import { ms } from '../../../scripts/ms.mjs'
import { get_hosturl_in_local_ip } from '../../../scripts/ratelimit.mjs'
import { baseScriptLoadedTime } from '../../base.mjs'
import { config, hosturl } from '../../server.mjs'


/**
 * 日志线路绑定的具体控制台实例。
 *
 * 全局 `console` 是按 `AsyncLocalStorage` 解析的代理，模块构造期与连接请求期可能落到不同实例；
 * 直接把代理交给 wire 处理器时，历史快照与 append 监听会各自绑定到一个实例，令快照恒为空。
 * 固定构造期解析出的具体实例，保证同一控制台既接收 append 又提供快照。
 * @type {import('npm:@steve02081504/virtual-console').VirtualConsole}
 */
const logConsole = getGlobalConsoleResolver().getActiveConsole()

/**
 * 日志查看器 WebSocket 服务句柄。
 */
export const logServiceWebSocketHandler = createLogWireWebSocketHandler(logConsole, {
	/**
	 * 在新查看器打开且时机合适时推送 ASCII Logo、URL 与随机 tips，用于方便用户和展现人情味。
	 * @param {{ ws: import('npm:ws').WebSocket }} root0 - 客户端连接上下文。
	 * @param {import('npm:ws').WebSocket} root0.ws - 刚建立的 WebSocket。
	 * @returns {Promise<void>}
	 */
	onClientConnected: async ({ ws }) => {
		if (logConsole.outputEntries.length < 72 || baseScriptLoadedTime.getTime() > Date.now() - ms('5m')) return
		const ansi_hosturl = `\x1b]8;;${hosturl}\x1b\\${hosturl}\x1b]8;;\x1b\\`
		let text = ''
		if (config.https?.enabled)
			text += geti18nForTerminal('fountConsole.server.showUrl.https', { url: ansi_hosturl }) + '\n'
		else
			text += geti18nForTerminal('fountConsole.server.showUrl.http', { url: ansi_hosturl }) + '\n'
		try {
			const local_url = get_hosturl_in_local_ip()
			text += geti18nForTerminal('fountConsole.server.localUrl', { url: local_url }) + '\n'
			const qrcode = await import('npm:qrcode-terminal')
			text += await new Promise((resolve) => qrcode.generate(local_url, { small: true }, resolve))
			text += '\n'
		} catch (e) { /* ignore */ }
		text += geti18nForTerminal('tips.title') + '\n'
		text += geti18nForTerminal('tips.data') + '\n'
		try { ws.send(JSON.stringify({ type: 'show_initial_info', text })) } catch (e) { /* ignore */ }
	},
	clientMessageHandlers: {
		/**
		 * 响应客户端「随机一条 tip」请求。
		 * @returns {{ type: 'output', text: string }} 供前端展示的输出帧。
		 */
		rand_tip: () => {
			let text = ''
			text += geti18nForTerminal('tips.title') + '\n'
			text += geti18nForTerminal('tips.data') + '\n'
			return {
				type: 'output',
				text
			}
		}
	}
})

/**
 * 在进程退出前向所有已连接的日志查看器发送 `fount_exit` 并关闭连接。
 * @param {number|undefined} code - 进程退出码。
 * @returns {Promise<void>} 所有连接关闭后兑现。
 */
on_shutdown(async (code) => {
	await logServiceWebSocketHandler.closeAllWithFinalJson({ type: 'fount_exit', code: code ?? 0 })
})
