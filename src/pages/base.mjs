// load Sentry

/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { onServerEvent } from './scripts/server_events.mjs'
import { showToast } from './scripts/toast.mjs'

Sentry.init({
	dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
	sendDefaultPii: true,
	tunnel: '/api/sentrytunnel',
	integrations: [
		Sentry.browserTracingIntegration()
	],
	// Performance Monitoring
	tracesSampleRate: 1.0,
	tracePropagationTargets: [window.location.origin || 'localhost'],
})

await import('https://cdn.jsdelivr.net/gh/steve02081504/js-polyfill/index.mjs')

// register service worker
if ('serviceWorker' in navigator)
	navigator.serviceWorker.register('/service_worker.mjs', { scope: '/', module: true })
		.catch(error => {
			console.error('Service Worker registration failed: ', error)
		})

if (new Date().getDate() === 1 && new Date().getMonth() === 3)
	if (Math.random() < 0.01)
		if (navigator.userLanguage == 'zh-CN' || navigator.userLanguage == 'zh' || navigator.language == 'zh-CN' || navigator.language == 'zh')
			window.location.href = 'https://96110.pages.dev/CloudFlare/CF'
		else
			window.location.href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

// set prerender rules
if (HTMLScriptElement.supports?.('speculationrules')) {
	const specScript = document.createElement('script')
	specScript.type = 'speculationrules'
	specScript.textContent = JSON.stringify({
		prerender: [{
			where: {
				href_matches: '/*'
			},
			eagerness: 'moderate'
		}]
	})
	document.head.prepend(specScript)
}

/**
 * 当按下 "Escape" 键时，如果历史记录大于 1，则后退，否则关闭窗口。
 * @param {KeyboardEvent} event - 键盘事件。
 * @returns {void}
 */
document.addEventListener('keydown', event => {
	if (event.key === 'Escape')
		if (history.length > 1) history.back()
		else window.close()
})

let currentCommitId
/**
 * 处理版本更新。
 * @param {object} param0 - 参数对象。
 * @param {string} param0.commitId - 提交 ID。
 */
function handleVersionUpdate({ commitId }) {
	if (!commitId) return
	currentCommitId ??= commitId
	if (currentCommitId !== commitId) window.location.reload(true)
}
onServerEvent('server-updated', handleVersionUpdate)
onServerEvent('server-reconnected', handleVersionUpdate)

/**
 * 显示一个 toast 通知。
 * @param {object} param0 - 参数对象。
 * @param {string} param0.type - toast 的类型。
 * @param {string} param0.message - toast 的消息。
 * @param {number} param0.duration - toast 的持续时间。
 * @returns {void}
 */
onServerEvent('show-toast', ({ type, message, duration }) => {
	showToast(type, message, duration)
})

; (f => document.readyState === 'complete' ? f() : window.addEventListener('load', f))(async () => {
	console.log(...await fetch('https://cdn.jsdelivr.net/gh/steve02081504/fount/imgs/icon.js').then(r => r.text()).then(eval))
	console.log('Curious? Join us and build future together: https://github.com/steve02081504/fount')

	// Dispatch host info for browser integration script
	const event = new CustomEvent('fount-host-info', {
		detail: {
			protocol: window.location.protocol,
			host: window.location.host,
		}
	})
	window.dispatchEvent(event)
})

/**
 * 基础目录。
 * @type {string}
 */
export const base_dir = '/'
