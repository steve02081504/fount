/**
 * 主页 shell 的客户端入口点。
 * 负责初始化和启动 Home shell 的核心逻辑。
 */
import { showToast } from '../../scripts/toast.mjs'

import { initializeApp, refreshApp } from './src/home.mjs'

initializeApp().then(async () => {
	if (navigator.serviceWorker.controller) {
		const channel = new MessageChannel()
		navigator.serviceWorker.controller.postMessage({ type: 'EXIT_COLD_BOOT' }, [channel.port2])
		/**
		 * 处理来自服务工作线程的消息。
		 * @param {MessageEvent} event - 消息事件对象。
		 * @returns {void}
		 */
		channel.port1.onmessage = async (event) => {
			if (event.data.wasColdBoot) {
				console.log('Exited cold boot mode, reloading data...')
				try { await refreshApp() } catch (error) {
					window.location = '/login'
				}
			}
		}
	}
}).catch(error => {
	showToast('error', error.message)
})
