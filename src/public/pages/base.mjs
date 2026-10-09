// load Sentry

/**
 * Sentry 浏览器 SDK 模块。
 * @type {import('npm:@sentry/browser')}
 */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { onServerEvent } from './scripts/endpoints/server_events.mjs'
import { firstPositive, probeServerReachability } from './scripts/lib/serverReachability.mjs'
import './scripts/motion/index.mjs'

let skipBreadcrumb = false

/**
 * 等待 Service Worker 接管的超时（毫秒）。
 * 首次注册激活通常远快于此；只有注册被拒/永不激活才会耗满。
 */
const SERVICE_WORKER_CONTROLLER_TIMEOUT_MS = 5000

/**
 * 等待 Service Worker 应答 `postMessage` 的超时（毫秒）。
 * 正常回执是同一个事件循环内的事；超时说明 worker 正在更新/已被杀。
 */
const SERVICE_WORKER_REPLY_TIMEOUT_MS = 3000

/**
 * 在限定时间内等待 Promise，超时与拒绝都返回兜底值（不抛出）。
 * 页面启动路径上的 Service Worker 等待都必须走这里：注册被拒时
 * `navigator.serviceWorker.ready` 永不 settle，未设上限的 await 会把启动页吊死在 loading 上。
 * @template T
 * @param {Promise<T>} promise - 被等待的 Promise
 * @param {number} timeoutMs - 超时毫秒
 * @param {T} [fallback] - 超时/拒绝时的兜底值
 * @returns {Promise<T>} 结果或兜底值
 */
async function waitWithTimeout(promise, timeoutMs, fallback) {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer
	try {
		return await Promise.race([
			promise.catch(() => fallback),
			new Promise(resolve => { timer = setTimeout(resolve, timeoutMs, fallback) }),
		])
	}
	finally {
		clearTimeout(timer)
	}
}

/**
 * 向 Service Worker 发一条消息并等它回执。
 * @param {ServiceWorker} controller - 当前页面的 Service Worker
 * @param {string} type - 消息类型
 * @returns {Promise<any>} 回执数据；worker 不回话（正在更新/已被杀）时为 undefined
 */
async function askServiceWorker(controller, type) {
	return await waitWithTimeout(new Promise(resolve => {
		const channel = new MessageChannel()
		/**
		 * 处理 Service Worker 返回的消息。
		 * @param {MessageEvent} event - 消息事件。
		 * @returns {void}
		 */
		channel.port1.onmessage = event => resolve(event.data)
		controller.postMessage({ type }, [channel.port2])
	}), SERVICE_WORKER_REPLY_TIMEOUT_MS)
}

/**
 * 初始化 Service Worker 活跃状态同步与通知抑制分发。
 * @returns {void}
 */
function initServiceWorkerIntegration() {
	if (!navigator.serviceWorker) return
	navigator.serviceWorker.addEventListener('message', event => {
		const { type, data, suppressed } = event.data || {}
		if (type !== 'notification') return
		// 始终抛事件：各 shell 据此更新页内角标（通知驱动，不依赖是否活跃）
		window.dispatchEvent(new CustomEvent('fount-notification', { detail: { ...data, suppressed: !!suppressed } }))
		if (!suppressed) return
		// 载荷要求跳过页内声音时（如 code shell 自行播放完成音）不重复播放
		if (data?.options?.data?.suppressPageSound === true) return
		// 页面活跃时播放页面内通知音；播放失败则回退到系统通知
		import('./scripts/features/notificationSound.mjs')
			.then(({ playNotificationSound }) => playNotificationSound())
			.catch(() => {
				const controller = navigator.serviceWorker?.controller
				if (controller) controller.postMessage({ type: 'SHOW_NOTIFICATION_FALLBACK', data })
			})
	})
	// SW 接管时立即同步一次活跃状态
	navigator.serviceWorker.addEventListener('controllerchange', async () => {
		const { syncUserActivityNow } = await import('./scripts/features/userActivity.mjs')
		syncUserActivityNow()
	})
}
/**
 * 首次用户手势时预解锁通知音音频上下文，避免首个完成通知被浏览器自动播放策略拦截。
 * @returns {void}
 */
function initNotificationSoundOnGesture() {
	/**
	 * 动态导入并初始化通知音，随后移除其余手势监听。
	 * @returns {void}
	 */
	const unlock = () => {
		window.removeEventListener('pointerdown', unlock, true)
		window.removeEventListener('keydown', unlock, true)
		import('./scripts/features/notificationSound.mjs')
			.then(({ initNotificationSound }) => initNotificationSound())
			.catch(() => { /* 音频不可用：忽略 */ })
	}
	window.addEventListener('pointerdown', unlock, { once: true, capture: true })
	window.addEventListener('keydown', unlock, { once: true, capture: true })
}
initNotificationSoundOnGesture()

if (!globalThis.fount?.test?.enabled) try {
	Sentry.init({
		dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
		release: 'not-set-yet',
		/**
		 * 在 Sentry 捕获面包屑事件之前进行处理。
		 * @param {object} breadcrumb - Sentry捕获到的面包屑事件对象。
		 * @param {object} hint - 包含原始事件等信息的辅助对象。
		 * @returns {object | null} 返回修改后的面包屑对象，或 null 以忽略此面包屑。
		 */
		beforeBreadcrumb: (breadcrumb, hint) => {
			if (skipBreadcrumb) return null
			return breadcrumb
		},
		sendDefaultPii: true,
		tunnel: '/api/sentrytunnel',
		integrations: [
			Sentry.browserTracingIntegration()
		],
		// Performance Monitoring
		tracesSampleRate: 1.0,
		tracePropagationTargets: [window.location.origin || 'localhost'],
	})
} catch (error) { console.error(error) }
console.noBreadcrumb = {
	/**
	 * 写入日志并跳过面包屑记录
	 * @param {...any} args - 要记录的日志
	 */
	log: (...args) => {
		skipBreadcrumb = true
		console.log(...args)
		skipBreadcrumb = false
	}
}

await import('https://cdn.jsdelivr.net/gh/steve02081504/js-polyfill/index.mjs').catch(console.error)

globalThis.fount ??= {}
globalThis.fount.version ??= 'unknown'
if (globalThis.fount?.test?.enabled && !globalThis.fount?.test?.watch?.disabled && globalThis.window === globalThis.top) import('/scripts/test/watch/index.mjs')

/**
 * 向 Service Worker 查询 fount 版本（commit hash）。
 * @returns {Promise<string>} fount 版本字符串
 */
async function queryFountVersion() {
	const controller = navigator.serviceWorker.controller
	const reply = controller && await askServiceWorker(controller, 'GET_FOUNT_VERSION')
	const version = reply?.fountVersion || 'unknown'
	Sentry.setTag('release', globalThis.fount.version = version)
	return version
}

/**
 * @param {string} base64String URL-safe base64
 * @returns {Uint8Array} applicationServerKey
 */
function urlBase64ToUint8Array(base64String) {
	const padding = '='.repeat((4 - base64String.length % 4) % 4)
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
	const raw = atob(base64)
	const output = new Uint8Array(raw.length)
	for (let index = 0; index < raw.length; index++)
		output[index] = raw.charCodeAt(index)
	return output
}

/**
 * 注册 Web Push 订阅并上报服务端。
 * @returns {Promise<void>} 无返回值
 */
async function ensureWebPushSubscription() {
	const registration = await navigator.serviceWorker?.ready
	if (!registration?.pushManager) return
	const keyResponse = await fetch('/api/notify/vapid-public-key', { credentials: 'include' })
	if (!keyResponse.ok) return
	const { publicKey } = await keyResponse.json()
	if (!publicKey) return
	const applicationServerKey = urlBase64ToUint8Array(publicKey)
	let subscription = await registration.pushManager.getSubscription()
	subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
	await fetch('/api/notify/push-subscribe', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(subscription.toJSON()),
	})
}

// register service worker
/** 当前页面的注册尝试：注册被拒时用它让 controller 的等待立刻结束，而不是白等满上限。 */
let serviceWorkerRegistration
; (async () => {
	if (!navigator.serviceWorker) return
	try {
		serviceWorkerRegistration = navigator.serviceWorker.register('/service_worker.mjs', { scope: '/', type: 'module' })
		await serviceWorkerRegistration
		await navigator.serviceWorker.ready
		initServiceWorkerIntegration()
		const { initUserActivityTracking } = await import('./scripts/features/userActivity.mjs')
		initUserActivityTracking()
	} catch (error) {
		if (error.name != 'SecurityError') console.error('Service Worker registration failed: ', error)
		return
	}
	// 推送订阅是可选的：浏览器/用户没给通知权限（NotAllowedError「Registration failed - permission denied」）
	// 只是没有推送能力，不能记成「Service Worker 注册失败」——那会把正常的推送拒绝说成 SW 故障。
	await Promise.all([
		ensureWebPushSubscription().catch(error => console.warn('Web push subscription unavailable: ', error)),
		queryFountVersion(),
	])
})()

/** 永不 settle 的 Promise：用于「这条分支不会给出结果」时把竞争让给另一条。 */
const NEVER_SETTLES = new Promise(() => { })

const is_hidden_page = !window.innerHeight || !window.innerWidth

/**
 * 等待 Service Worker 接管当前页面后返回其 controller。
 * 新注册的 worker 尚未 claim 页面时，controller 暂时为 null，需等
 * `navigator.serviceWorker.ready` 与 `controllerchange` 后才有可用的 controller，
 * 以便 WAKE_SERVER_REQUEST 能送达新激活的 worker。
 * 注册被浏览器拒绝（无痕 / 内嵌 WebView 的 NotAllowedError 等）时 `ready` 永不 settle，
 * 因此整段等待必须有上限：没有 controller 只是失去推送/离线能力，不能拖死页面启动
 *（启动页会因此停在 loading 上，连未登录的登录跳转都到不了）。
 * 而注册一旦失败就说明不会再有 controller 出现了，此时不必白等满上限——启动页是 `await wakeServer()` 的，
 * 那 5 秒会直接加在启动耗时上；注册成功的那条分支则继续按正常流程等接管。
 * @returns {Promise<ServiceWorker | null>} 控制当前页面的 Service Worker，无则返回 null。
 */
async function waitServiceWorkerController() {
	if (!navigator.serviceWorker) return null
	if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller
	/** 新注册的 worker 尚未 claim 页面：`ready` 之后还要等一次 `controllerchange`。 */
	const waitForClaim = async () => {
		await navigator.serviceWorker.ready
		if (navigator.serviceWorker.controller) return
		await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
	}
	/** 注册失败（被浏览器拒绝）时给出信号；注册成功则永不 settle，继续走正常的接管等待。 */
	const registrationRefused = serviceWorkerRegistration
		? serviceWorkerRegistration.then(() => NEVER_SETTLES, () => 'refused')
		: NEVER_SETTLES
	await waitWithTimeout(Promise.race([waitForClaim(), registrationRefused]), SERVICE_WORKER_CONTROLLER_TIMEOUT_MS)
	return navigator.serviceWorker.controller
}

/**
 * 通知 Service Worker 退出冷启动模式。
 * 仅在服务器可达时调用；controller 可能尚未接管当前页面，需判空。
 * @returns {void}
 */
function exitColdBoot() {
	const controller = navigator.serviceWorker?.controller
	if (controller) controller.postMessage({ type: 'EXIT_COLD_BOOT' })
}

/**
 * 向 Service Worker 查询服务器是否适合启动。
 *
 * 两路并行、先有肯定答案者胜：SW 询问（可能本身就把服务器唤醒）与资源探测
 * （`probeServerReachability`，其判定预算按本次通道实测的往返时延推导，而不是写死毫秒数——
 * 写死的值在隧道/代理上会把正常请求判成失败，进而误拉 `fount://` 协议处理器）。
 * SW 先答「可以」时把并行的探测中止掉，省掉那次多余的请求。
 * @returns {Promise<boolean>} 是否适合启动服务器。
 */
export async function queryWakeServer() {
	const controller = await waitServiceWorkerController()
	// worker 没回话（正在更新 / 已被杀）时按「没有 controller」继续，不能把启动吊死在这里。
	const approvedPromise = controller
		? askServiceWorker(controller, 'WAKE_SERVER_REQUEST').then(reply => !!reply?.approved)
		: Promise.resolve(false)
	const probeAbort = new AbortController()
	const reachable = await firstPositive([
		approvedPromise.then(approved => {
			if (approved) probeAbort.abort()
			return approved
		}),
		probeServerReachability({ signal: probeAbort.signal }),
	])
	// 服务器可达且非预渲染页面：中心化退出冷启动，使 chat/tutorial 等页面一并生效。
	if (reachable && !document.prerendering) exitColdBoot()
	return reachable
}

/**
 * 通过 fount 自定义协议唤醒本地服务器。
 * @returns {Promise<void>}
 */
export async function wakeServer() {
	if (await queryWakeServer()) return
	const iframe = document.createElement('iframe')
	iframe.ariaHidden = true
	iframe.style.display = 'none'
	iframe.src = 'fount://nop/'
	document.body.appendChild(iframe)
}

// 非根目录页面：自动检测服务器是否在线，不在线时通过 fount 协议唤醒。
if (!is_hidden_page) if (!['', '/'].includes(window.location.pathname))
	wakeServer()

if (!is_hidden_page) if (new Date().getDate() === 1 && new Date().getMonth() === 3)
	if (Math.random() < 0.01)
		if (navigator.userLanguage == 'zh-CN' || navigator.userLanguage == 'zh' || navigator.language == 'zh-CN' || navigator.language == 'zh')
			window.location.href = 'https://96110.pages.dev/CloudFlare/CF'
		else
			window.location.href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

// set prerender rules
if (!is_hidden_page) if (HTMLScriptElement.supports?.('speculationrules')) {
	const specScript = document.createElement('script')
	specScript.type = 'speculationrules'
	specScript.textContent = JSON.stringify({
		prerender: [{
			where: {
				and: [
					{ href_matches: '/*' },
					{ not: { href_matches: '/parts/shells:chat*' } },
				],
			},
			eagerness: 'moderate'
		}]
	})
	document.head.prepend(specScript)
}

/**
 * 处理键盘事件。
 * @param {KeyboardEvent} event - 键盘事件。
 * @returns {void}
 */
if (!is_hidden_page) document.addEventListener('keydown', event => {
	switch (event.key) {
		case 'Escape':
			if (history.length > 1) history.back()
			else window.close()
			break
		case 'F1':
			window.open('https://t.me/GentianAphrodite', '_blank')
			break
	}
})

let currentCommitId
let updateTimeout
/**
 * 设置需要更新，这将在 5 秒后或窗口聚焦时刷新页面。
 */
function setUpdateNeeded() {
	if (updateTimeout) clearTimeout(updateTimeout)
	updateTimeout = setTimeout(() => {
		window.location.reload(true)
	}, 5000)
}
if (!is_hidden_page) window.addEventListener('focus', () => {
	if (updateTimeout) window.location.reload(true)
})
/**
 * 处理版本更新。
 * @param {object} param0 - 参数对象。
 * @param {string} param0.commitId - 提交 ID。
 */
function handleVersionUpdate({ commitId }) {
	if (!commitId) return
	currentCommitId ??= commitId
	if (currentCommitId !== commitId) setUpdateNeeded()
}
onServerEvent('server-updated', handleVersionUpdate)
onServerEvent('server-reconnected', handleVersionUpdate)
onServerEvent('page-modified', ({ path }) => {
	if (window.location.pathname.startsWith(path)) setUpdateNeeded()
})

/**
 * 显示一个 toast 通知。
 * @param {object} param0 - 参数对象。
 * @param {string} param0.type - toast 的类型。
 * @param {string} param0.message - toast 的消息。
 * @param {number} param0.duration - toast 的持续时间。
 * @returns {void}
 */
if (!is_hidden_page) onServerEvent('show-toast', async ({ type, message, duration }) => {
	const { showToast } = await import('./scripts/features/toast.mjs')
	showToast(type, message, duration)
})

if (!is_hidden_page) (f => document.readyState === 'complete' ? f() : window.addEventListener('load', f))(async () => {
	try {
		console.noBreadcrumb.log(...await fetch('https://cdn.jsdelivr.net/gh/steve02081504/fount/imgs/icon.js').then(r => r.text()).then(eval))
	} catch (error) { console.error(error) }
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
