
import { createLogWireWebSocketHandler } from 'npm:@steve02081504/virtual-console/wire/server'
import { on_shutdown } from 'npm:on-shutdown'

import { console, geti18n } from '../../scripts/i18n.mjs'
import { ms } from '../../scripts/ms.mjs'
import { get_hosturl_in_local_ip } from '../../scripts/ratelimit.mjs'
import { baseScriptLoadedTime } from '../base.mjs'
import { config, hosturl } from '../server.mjs'


/**
 * 日志查看器 WebSocket 服务句柄。
 */
export const logServiceWebSocketHandler = createLogWireWebSocketHandler(console, {
	/**
	 * 在新查看器打开且时机合适时推送 ASCII Logo、URL 与随机 tips，用于方便用户和展现人情味。
	 * @param {{ ws: import('npm:ws').WebSocket }} root0 - 客户端连接上下文。
	 * @param {import('npm:ws').WebSocket} root0.ws - 刚建立的 WebSocket。
	 * @returns {Promise<void>}
	 */
	onClientConnected: async ({ ws }) => {
		if (console.outputEntries.length < 72 || baseScriptLoadedTime.getTime() > Date.now() - ms('5m')) return
		const ansi_hosturl = `\x1b]8;;${hosturl}\x1b\\${hosturl}\x1b]8;;\x1b\\`
		let text = ''
		if (config.https?.enabled)
			text += geti18n('fountConsole.server.showUrl.https', { url: ansi_hosturl }) + '\n'
		else
			text += geti18n('fountConsole.server.showUrl.http', { url: ansi_hosturl }) + '\n'
		try {
			const local_url = get_hosturl_in_local_ip()
			text += geti18n('fountConsole.server.localUrl', { url: local_url }) + '\n'
			const qrcode = await import('npm:qrcode-terminal')
			text += await new Promise((resolve) => qrcode.generate(local_url, { small: true }, resolve))
			text += '\n'
		} catch (e) { /* ignore */ }
		text += geti18n('tips.title') + '\n'
		text += geti18n('tips.data') + '\n'
		try { ws.send(JSON.stringify({ type: 'show_initial_info', text })) } catch (e) { /* ignore */ }
	},
	clientMessageHandlers: {
		/**
		 * 响应客户端「随机一条 tip」请求。
		 * @returns {{ type: 'output', text: string }} 供前端展示的输出帧。
		 */
		rand_tip: () => {
			let text = ''
			text += geti18n('tips.title') + '\n'
			text += geti18n('tips.data') + '\n'
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
