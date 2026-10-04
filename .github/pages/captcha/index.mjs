import { initTranslations, setElementI18n } from '../scripts/i18n/index.mjs'
import { applyTheme } from '../scripts/theme/index.mjs'

import { detectPlatform, getInstallGuide, selectLocalVerificationResponse } from './install_guide.mjs'

applyTheme()
await initTranslations('captcha')

const params = new URLSearchParams(location.search)
const requesterNodeHash = params.get('requesterNodeHash')
const challenge = params.get('challenge')
const expiresAt = Number(params.get('expiresAt'))
const statusBox = document.getElementById('status')
const statusText = document.getElementById('status-text')
const installHelp = document.getElementById('install-help')
const commandElement = document.getElementById('install-command')
const copyButton = document.getElementById('copy-command')

/**
 * 检查值是否为 64 位十六进制字符串。
 * @param {unknown} value 待检查的值
 * @returns {boolean} 是否为有效哈希
 */
const validHex = value => typeof value === 'string' && /^[\da-f]{64}$/i.test(value)
/** 验证链接中的参数是否完整有效。 */
const isValidRequest = validHex(requesterNodeHash) && validHex(challenge) && Number.isFinite(expiresAt) && expiresAt > 0

/** 根据操作系统显示相应的安装命令和步骤。 */
function configureInstallHelp() {
	const platform = detectPlatform(navigator.userAgent || '', navigator.userAgentData?.platform || navigator.platform || '')
	const guide = getInstallGuide(platform)
	const android = platform === 'android'
	const windows = platform === 'windows'
	const command = guide.command
	setElementI18n(document.getElementById('unix-instruction'), `captcha.install.platforms.${platform}`)
	document.getElementById('command-steps').classList.toggle('hidden', platform === 'unknown')
	commandElement.textContent = command
	commandElement.dataset.command = command
	document.getElementById('android-help').classList.toggle('hidden', !android)
	document.getElementById('windows-help').classList.toggle('hidden', !windows)
	document.getElementById('unix-help').classList.toggle('hidden', android || windows)
	installHelp.classList.remove('hidden')
}

/** 复制当前平台的安装命令；剪贴板不可用时选中命令文本。 */
copyButton.addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(commandElement.dataset.command)
		setElementI18n(copyButton, 'captcha.command.copied')
	} catch {
		const selection = window.getSelection()
		const range = document.createRange()
		range.selectNodeContents(commandElement)
		selection?.removeAllRanges()
		selection?.addRange(range)
		setElementI18n(copyButton, 'captcha.command.manualCopy')
	}
	setTimeout(() => { setElementI18n(copyButton, 'captcha.command.copy') }, 2500)
})

/**
 * 更新页面状态提示。
 * @param {string} message 要显示的状态
 * @param {'info'|'success'|'warning'|'error'} kind 提示样式
 */
function setStatus(message, kind = 'info') {
	statusBox.className = `alert alert-${kind}`
	setElementI18n(statusText, `captcha.status.${message}`)
	statusBox.replaceChildren(statusText)
}

/**
 * 向本机 fount/subfount 请求完成 P2P 挑战。
 * @returns {Promise<{status:string,nodeHash?:string,reason?:string}>} 本机挑战结果
 */
async function checkLocalFount() {
	const checks = [8931, 8932].map(async port => {
		const endpoint = new URL(`http://localhost:${port}/api/p2p/verification/local`)
		endpoint.searchParams.set('requesterNodeHash', requesterNodeHash)
		endpoint.searchParams.set('challenge', challenge)
		endpoint.searchParams.set('expiresAt', String(expiresAt))
		const response = await fetch(endpoint, {
			method: 'GET',
			mode: 'cors',
			credentials: 'omit',
			cache: 'no-store',
		})
		if (!response.ok) throw new Error(`本机服务返回 HTTP ${response.status}`)
		return response.json()
	})
	const results = await Promise.allSettled(checks)
	return selectLocalVerificationResponse(results, validHex)
}

/** 持续向本机服务重试，直到通过、失败或链接过期。 */
async function verifyLoop() {
	if (!isValidRequest) {
		setStatus('invalid', 'error')
		return
	}
	if (expiresAt <= Date.now()) {
		setStatus('expired', 'error')
		return
	}

	let shownHelp = false
	while (Date.now() < expiresAt) {
		try {
			const result = await checkLocalFount()
			if (result?.status === 'verified' && validHex(result.nodeHash)) {
				installHelp.classList.add('hidden')
				setStatus('success', 'success')
				return
			}
			if (result?.status === 'failed') {
				if (['invalid challenge', 'challenge mismatch', 'timeout'].includes(result.reason)) {
					setStatus('failed', 'error')
					return
				}
				setStatus('connecting', 'warning')
				shownHelp = true
				configureInstallHelp()
			}
		} catch {
			if (!shownHelp) {
				shownHelp = true
				configureInstallHelp()
				setStatus('missing', 'warning')
			}
		}
		await new Promise(resolve => setTimeout(resolve, 1500))
	}
	setStatus('expired', 'error')
}

verifyLoop().catch(() => setStatus('failed', 'error'))

const whyButton = document.getElementById('why-button')
const helpBubble = whyButton.parentElement
let pinnedHelp = false
/**
 * 显示或收起说明，同时更新屏幕阅读器状态。
 * @param {boolean} open 是否展开
 * @returns {void} 无返回值
 */
function showHelp(open) {
	helpBubble.classList.toggle('open', open)
	whyButton.setAttribute('aria-expanded', String(open))
}
helpBubble.addEventListener('mouseenter', () => showHelp(true))
helpBubble.addEventListener('mouseleave', () => { if (!pinnedHelp && document.activeElement !== whyButton) showHelp(false) })
whyButton.addEventListener('focus', () => showHelp(true))
whyButton.addEventListener('blur', () => { if (!pinnedHelp) showHelp(false) })
whyButton.addEventListener('click', () => {
	pinnedHelp = !pinnedHelp
	showHelp(pinnedHelp)
})
whyButton.addEventListener('keydown', event => {
	if (event.key === 'Escape') {
		pinnedHelp = false
		showHelp(false)
	}
})
document.addEventListener('pointerdown', event => {
	if (!helpBubble.contains(event.target)) {
		pinnedHelp = false
		showHelp(false)
	}
})
