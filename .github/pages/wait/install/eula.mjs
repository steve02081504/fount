/**
 * 安装前 EULA：jsDelivr 拉取协议（回落 GitHub raw）。
 * 首页点安装则同意后下载 release；runner 打开时同意后信令本机安装器。
 */
import { marked } from 'https://cdn.jsdelivr.net/npm/marked/+esm'

import {
	getAvailableLocales,
	getBestLocale,
	getLocaleNames,
	primaryLocale,
	setElementI18n,
} from '../../scripts/i18n/index.mjs'

/** 构建时替换为当前 git 引用（分支名或 commit）。 */
const FOUNT_GIT_REF = '__FOUNT_GIT_REF__'

/** 本机 runner 状态服务。 */
export const INSTALLER_STATUS_ORIGIN = 'http://localhost:8930'

/** localStorage：曾在本源同意过 EULA。 */
export const EULA_STORAGE_KEY = 'fountEulaAccepted'

const eulaDialog = document.getElementById('eula-dialog')
const eulaBackdrop = document.getElementById('eula-backdrop')
const eulaBody = document.getElementById('eula-body')
const eulaLocaleSelect = document.getElementById('eula-locale')
const eulaAgree = document.getElementById('eula-agree')
const eulaContinue = document.getElementById('eula-continue')

let eulaLoaded = false
/** 仅首页下载流程在加载中可关；runner/open 全程锁定。 */
let dismissible = false
let continueAt = 0
let countdownTimer = 0
/** @type {AbortController | null} */
let eulaAbort = null
let localeOptionsReady = false
/** @type {(() => void) | null} */
let acceptResolve = null
/** @type {Promise<void> | null} */
let acceptPromise = null
let runnerWatchStarted = false

/**
 * 按浏览器平台信息选择 release 资产名。
 * @returns {string} `fount.exe` 或 `fount.sh`
 */
export function installerAssetName() {
	const platform = navigator.userAgentData?.platform || navigator.platform || ''
	return /^win/i.test(platform) ? 'fount.exe' : 'fount.sh'
}

/**
 * GitHub latest release 直链。
 * @returns {string} 下载 URL
 */
export function installerDownloadUrl() {
	return `https://github.com/steve02081504/fount/releases/latest/download/${installerAssetName()}`
}

/**
 * 本源是否已同意过 EULA。
 * @returns {boolean} 是否已同意
 */
export function hasAcceptedEula() {
	return localStorage.getItem(EULA_STORAGE_KEY) === '1'
}

/**
 * 记下本源已同意 EULA。
 * @returns {void}
 */
export function markEulaAccepted() {
	localStorage.setItem(EULA_STORAGE_KEY, '1')
}

/**
 * EULA markdown 的 jsDelivr / GitHub raw URL。
 * @param {string} locale 语言 id
 * @returns {string[]} 按优先级
 */
function eulaMarkdownUrls(locale) {
	const path = `docs/EULA/EULA.${locale}.md`
	return [
		`https://cdn.jsdelivr.net/gh/steve02081504/fount@${FOUNT_GIT_REF}/${path}`,
		`https://raw.githubusercontent.com/steve02081504/fount/${FOUNT_GIT_REF}/${path}`,
	]
}

/**
 * 按 URL 列表依次拉取文本。
 * @param {string[]} urls 候选
 * @param {AbortSignal} signal 取消
 * @returns {Promise<string>} 正文
 */
async function fetchTextFallback(urls, signal) {
	let lastError
	for (const url of urls)
		try {
			const response = await fetch(url, { signal })
			if (!response.ok) {
				lastError = new Error(`${response.status} ${url}`)
				continue
			}
			return await response.text()
		}
		catch (error) {
			if (error?.name === 'AbortError') throw error
			lastError = error
		}

	throw lastError || new Error('EULA fetch failed')
}

/**
 * 同意倒计时毫秒数。
 * @returns {number} 毫秒
 */
function continueDelayMs() {
	return globalThis.fount?.test?.eulaContinueDelayMs ?? 13_000
}

/**
 * 填充 EULA 语言下拉（与产品 locale 列表同一套 id）。
 * @returns {void}
 */
function ensureLocaleOptions() {
	if (localeOptionsReady) return
	const names = getLocaleNames()
	for (const locale of getAvailableLocales()) {
		const option = document.createElement('option')
		option.value = locale
		option.textContent = names.get(locale) || locale
		eulaLocaleSelect.appendChild(option)
	}
	localeOptionsReady = true
}

/**
 * 刷新继续按钮：未加载 / 未同意 / 倒计时未完则禁用。
 * @returns {void}
 */
function syncContinueButton() {
	const remaining = Math.max(0, Math.ceil((continueAt - Date.now()) / 1000))
	eulaContinue.disabled = !(eulaLoaded && eulaAgree.checked && remaining === 0)
	if (remaining > 0)
		setElementI18n(eulaContinue, 'installer_wait_screen.eula.continue_in', { seconds: remaining })
	else
		setElementI18n(eulaContinue, 'installer_wait_screen.eula.continue', { seconds: null })
}

/**
 * 加载成功后开始倒计时。
 * @returns {void}
 */
function startCountdown() {
	continueAt = Date.now() + continueDelayMs()
	clearInterval(countdownTimer)
	syncContinueButton()
	countdownTimer = setInterval(syncContinueButton, 250)
}

/**
 * 按当前会话更新遮罩锁定。
 * @returns {void}
 */
function syncBackdropLock() {
	eulaBackdrop.toggleAttribute('inert', !dismissible || eulaLoaded)
}

/**
 * 拉取并渲染一份 EULA。
 * @param {string} locale 语言 id
 * @returns {Promise<void>}
 */
async function loadEula(locale) {
	eulaLoaded = false
	syncBackdropLock()
	clearInterval(countdownTimer)
	continueAt = Date.now() + continueDelayMs()
	syncContinueButton()

	eulaAbort?.abort()
	const abort = new AbortController()
	eulaAbort = abort

	eulaBody.replaceChildren()
	eulaBody.removeAttribute('lang')
	eulaBody.removeAttribute('dir')
	const loading = document.createElement('div')
	loading.className = 'flex flex-col items-center justify-center gap-3 py-12'
	loading.innerHTML = '<span class="loading loading-spinner loading-lg"></span>'
	const loadingLabel = document.createElement('span')
	loadingLabel.dataset.i18n = 'installer_wait_screen.eula.loading'
	loading.appendChild(loadingLabel)
	eulaBody.appendChild(loading)

	try {
		const markdown = await fetchTextFallback(eulaMarkdownUrls(locale), abort.signal)
		if (abort.signal.aborted) return
		eulaBody.innerHTML = marked.parse(markdown, { async: false })
		eulaBody.lang = locale
		eulaBody.dir = locale.startsWith('ar') ? 'rtl' : 'ltr'
		eulaLoaded = true
		syncBackdropLock()
		startCountdown()
	}
	catch (error) {
		if (error?.name === 'AbortError') return
		eulaBody.replaceChildren()
		const failed = document.createElement('p')
		failed.className = 'text-error'
		failed.dataset.i18n = 'installer_wait_screen.eula.load_failed'
		eulaBody.appendChild(failed)
		eulaLoaded = false
		continueAt = 0
		clearInterval(countdownTimer)
		syncBackdropLock()
		syncContinueButton()
	}
}

/**
 * 弹出 EULA 对话框并开始加载。
 * @returns {void}
 */
function showEulaDialog() {
	if (eulaDialog.open) return
	ensureLocaleOptions()
	const locale = getBestLocale(
		[primaryLocale(), ...navigator.languages || [navigator.language]],
		getAvailableLocales(),
	)
	eulaLocaleSelect.value = locale
	eulaAgree.checked = false
	eulaLoaded = false
	syncBackdropLock()
	eulaDialog.showModal()
	loadEula(locale)
}

/**
 * 完成本源同意并唤醒等待者。
 * @returns {void}
 */
function finishAccepted() {
	markEulaAccepted()
	acceptResolve?.()
	acceptResolve = null
	if (eulaDialog.open) eulaDialog.close()
}

/**
 * 若尚未同意则弹出 EULA，同意后（含 CLI 侧信令）resolve。
 * @param {{ allowDismiss?: boolean }} [options] `allowDismiss` 仅下载路径在加载中可关
 * @returns {Promise<void>}
 */
export function ensureEulaAccepted({ allowDismiss = false } = {}) {
	if (hasAcceptedEula()) return Promise.resolve()
	dismissible = allowDismiss
	if (!acceptPromise) 
		acceptPromise = new Promise(resolve => {
			acceptResolve = resolve
			showEulaDialog()
		}).finally(() => {
			acceptPromise = null
		})
	
	return acceptPromise
}

/**
 * 触发 release 资产下载（跨域走新标签，避免离开本页）。
 * @returns {void}
 */
function startInstallerDownload() {
	const file = installerAssetName()
	const a = document.createElement('a')
	a.href = installerDownloadUrl()
	a.download = file
	a.target = '_blank'
	a.rel = 'noopener noreferrer'
	a.click()
}

/**
 * 通知本机 runner：用户已同意 EULA，可以开始安装。
 * @returns {Promise<void>}
 */
export function notifyRunnerEulaAccepted() {
	return fetch(`${INSTALLER_STATUS_ORIGIN}/eula`, { cache: 'no-store' }).then(() => { }, () => { })
}

/**
 * 弹出 EULA；同意并倒计时结束后下载安装包。已同意则直接下载。
 * @returns {Promise<void>}
 */
export function promptEulaAndDownload() {
	return ensureEulaAccepted({ allowDismiss: true }).then(startInstallerDownload)
}

/**
 * 轮询 runner 状态：CLI 已同意时关掉对话框并唤醒等待者。
 * @returns {void}
 */
export function watchRunnerEulaAcceptance() {
	if (runnerWatchStarted) return
	runnerWatchStarted = true
	/** 直到本源已记下同意。 */
	const poll = async () => {
		if (hasAcceptedEula()) {
			finishAccepted()
			return
		}
		try {
			const response = await fetch(INSTALLER_STATUS_ORIGIN, { cache: 'no-store' })
			if (response.ok) {
				const data = await response.json()
				if (data?.eula === 'accepted') {
					finishAccepted()
					return
				}
			}
		}
		catch { /* 安装器尚未起来 */ }
		setTimeout(poll, 400)
	}
	poll()
}

eulaLocaleSelect.addEventListener('change', () => loadEula(eulaLocaleSelect.value))
eulaAgree.addEventListener('change', syncContinueButton)
eulaContinue.addEventListener('click', () => {
	if (eulaContinue.disabled) return
	finishAccepted()
})
eulaDialog.addEventListener('cancel', event => {
	if (!dismissible || eulaLoaded) event.preventDefault()
})
eulaDialog.addEventListener('close', () => {
	eulaAbort?.abort()
	eulaLoaded = false
	clearInterval(countdownTimer)
	syncBackdropLock()
	if (hasAcceptedEula()) {
		acceptResolve?.()
		acceptResolve = null
		return
	}
	if (!dismissible && acceptResolve) {
		queueMicrotask(showEulaDialog)
		return
	}
	acceptPromise = null
	acceptResolve = null
})
