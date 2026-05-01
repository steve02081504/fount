import { retrieveAndDecryptCredentials, redirectToLoginInfo } from '../scripts/credentialManager.mjs'
import {
	ping,
	generateVerificationCode,
	login,
	register,
	webauthnLoginBegin,
	webauthnLoginComplete,
} from '../scripts/endpoints.mjs'
import { initTranslations, console, savePreferredLangs, onLanguageChange, i18nElement } from '../scripts/i18n.mjs'
import { getAnyDefaultPart } from '../scripts/parts.mjs'
import { initPasswordStrengthMeter } from '../scripts/passwordStrength.mjs'
import { createPOWCaptcha } from '../scripts/POWcaptcha.mjs'
import { runPreloadIfNotSaveData } from '../scripts/preloadUrls.mjs'
import { applyTheme, setTheme } from '../scripts/theme.mjs'
import { showToast } from '../scripts/toast.mjs'

const form = document.getElementById('auth-form')
const formTitle = document.getElementById('form-title')
const submitBtn = document.getElementById('submit-btn')
const toggleLink = document.getElementById('toggle-link')
const confirmPasswordGroup = document.getElementById('confirm-password-group')
const errorMessage = document.getElementById('error-message')
const verificationCodeGroup = document.getElementById('verification-code-group')
const sendVerificationCodeBtn = document.getElementById('send-verification-code-btn')
const passwordStrengthFeedback = document.getElementById('password-strength-feedback')
const passwordInput = document.getElementById('password')
const webauthnLoginRow = document.getElementById('webauthn-login-row')
const webauthnLoginBtn = document.getElementById('webauthn-login-btn')

/** @type {((opts: object) => Promise<object>) | null} */
let startAuthenticationFn = null

const isLocalOrigin = await ping().then(data => data.is_local_ip).catch(() => false)

let isLoginForm = true
let verificationCodeSent = false
let sendCodeCooldown = false
let powCaptcha = null
let passwordStrengthMeter = null
let isWebAuthnInProgress = false

/**
 * 去掉 `#error-message` 上全部 `data-*`。
 * locale 模板里的 `${param}` 会通过 `dataset.param`（如 `data-time-left` → `timeLeft`）传入；逐项打表与服务端字段同步易漏，故一次清空。
 * @returns {void}
 */
function clearLoginErrorDataset() {
	for (const key of Object.keys(errorMessage.dataset))
		delete errorMessage.dataset[key]
}

/**
 * 在登录页 `#error-message` 显示文案（API 错误、前端校验、非错误提示如「验证码已发送」均走此入口）。
 * @param {object} [payload] - 与登录/注册/WebAuthn API JSON 体相同形状，或仅含 i18n 字段。
 * @param {string} [payload.i18nKey] - locale 点路径；缺省时为通用登录错误。
 * @param {Record<string, string | number>} [payload.i18nParams] - 翻译插值参数。
 * @returns {void}
 */
function showLoginMessage(payload) {
	errorMessage.textContent = ''
	clearLoginErrorDataset()
	const raw = String(payload?.i18nKey ?? '').trim()
	errorMessage.dataset.i18n = raw || 'auth.error.loginError'
	const params = payload?.i18nParams
	if (params != null)
		for (const [paramKey, val] of Object.entries(params))
			errorMessage.dataset[paramKey] = String(val)
	i18nElement(errorMessage, { skip_report: true })
}

/**
 * @returns {void}
 */
function clearLoginErrorDisplay() {
	errorMessage.textContent = ''
	clearLoginErrorDataset()
}

/**
 * 读取正文并 `JSON.parse`；语法失败则 `invalidJson`。
 * @param {Response} response - fetch `Response`，正文仅读取一次。
 * @returns {Promise<{ value: unknown, invalidJson: boolean }>} `value` 为任意 JSON 值（含数组）；`invalidJson` 表示正文非合法 JSON。
 */
async function parseResponseBodyJson(response) {
	const text = await response.text()
	if (!text) return { value: null, invalidJson: false }
	try {
		return { value: JSON.parse(text), invalidJson: false }
	} catch {
		return { value: null, invalidJson: true }
	}
}

/**
 * 初始化表单状态。
 * @returns {void}
 */
function initializeForm() {
	isLoginForm = true
}

/**
 * 切换表单。
 * @returns {void}
 */
function toggleForm() {
	isLoginForm = !isLoginForm
	updateFormDisplay()
}

/**
 * 处理切换链接点击事件。
 * @param {MouseEvent} event - 鼠标事件。
 * @returns {void}
 */
function handleToggleClick(event) {
	event.preventDefault()
	toggleForm()
}

/**
 * 刷新 UI 字符串。
 * @returns {void}
 */
function refreshUIStrings() {
	updateFormDisplay()
}

/**
 * 更新表单显示。
 * @returns {void}
 */
function updateFormDisplay() {
	const formType = isLoginForm ? 'login' : 'register'

	formTitle.dataset.i18n = `auth.${formType}.title`
	submitBtn.dataset.i18n = `auth.${formType}.submitButton`
	const [toggleText, toggleButton] = toggleLink.children
	toggleText.dataset.i18n = `auth.${formType}.toggleLink.textContent`
	toggleButton.dataset.i18n = `auth.${formType}.toggleLink.link`

	confirmPasswordGroup.style.display = isLoginForm ? 'none' : 'block'
	verificationCodeGroup.style.display = isLoginForm || isLocalOrigin ? 'none' : 'block'
	webauthnLoginRow.style.display = isLoginForm ? 'block' : 'none'
	passwordInput.autocomplete = isLoginForm ? 'current-password' : 'new-password'
	clearLoginErrorDisplay()

	if (isLoginForm) {
		verificationCodeSent = false
		sendVerificationCodeBtn.disabled = false
	}
}

/**
 * 解析登录成功后的应用内目标 URL（相对路径或同源绝对 URL + 当前 hash）。
 * @returns {Promise<string>} 带 hash 的跳转地址。
 */
async function resolveLoginSuccessTargetUrl() {
	const urlParams = new URLSearchParams(window.location.search)
	const redirect = urlParams.get('redirect')
	const defaultShell = await getAnyDefaultPart('shells') || 'home'

	let finalRedirectUrl
	if (redirect)
		finalRedirectUrl = decodeURIComponent(redirect)
	else
		finalRedirectUrl = `/parts/shells:${defaultShell}`

	if (redirect) try {
		const url = new URL(finalRedirectUrl, window.location.origin)
		const gobackNum = Number(url.searchParams.get('gobackNum') || 0)
		if (gobackNum) url.searchParams.set('gobackNum', gobackNum + 1)
		finalRedirectUrl = url.href
	} catch { /* URL 解析失败时保持原样 */ }

	return finalRedirectUrl + window.location.hash
}

/**
 * Passkey 登录成功后：直接跳进应用目标页。
 * @returns {Promise<void>}
 */
async function finalizePasskeyLoginRedirect() {
	window.location.href = await resolveLoginSuccessTargetUrl()
}

/**
 * 密码登录成功后：可选把用户名密码加密传到 login_info，再落到应用目标页。
 * @returns {Promise<void>}
 */
async function finalizePasswordLoginRedirect() {
	const username = document.getElementById('username').value
	redirectToLoginInfo(await resolveLoginSuccessTargetUrl(), username, passwordInput.value)
}

/**
 * 按需加载 @simplewebauthn/browser。
 * @returns {Promise<boolean>} 成功加载认证辅助库则为 true。
 */
async function loadWebAuthnBrowser() {
	if (startAuthenticationFn) return true
	try {
		const mod = await import('https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@13.3.0/+esm')
		startAuthenticationFn = mod.startAuthentication
		return true
	} catch (err) {
		console.error('Failed to load WebAuthn library:', err)
		return false
	}
}

/**
 * 使用安全密钥 / Passkey 登录。
 * @returns {Promise<void>}
 */
async function handleWebAuthnLogin() {
	if (!isLoginForm) return
	if (isWebAuthnInProgress) return
	const powToken = powCaptcha?.token
	if (!isLocalOrigin && !powToken) {
		showLoginMessage({ i18nKey: 'auth.error.powNotSolved' })
		return
	}
	clearLoginErrorDisplay()

	if (!await loadWebAuthnBrowser()) {
		showLoginMessage({ i18nKey: 'auth.webauthn.errorLoadLibrary' })
		return
	}

	isWebAuthnInProgress = true
	try {
		const beginRes = await webauthnLoginBegin(powToken)
		const { value: beginData, invalidJson } = await parseResponseBodyJson(beginRes)
		if (invalidJson) {
			showLoginMessage({
				i18nKey: beginRes.ok ? 'auth.webauthn.errorBadBeginResponse' : 'auth.error.apiErrorBodyUnreadable',
			})
			return
		}
		if (!beginRes.ok) {
			showLoginMessage(beginData ?? {})
			return
		}
		if (!beginData) {
			showLoginMessage({ i18nKey: 'auth.webauthn.errorBadBeginResponse' })
			return
		}
		if (!String(beginData.authSessionToken ?? '').trim()) {
			showLoginMessage({ i18nKey: 'auth.webauthn.errorSessionMissing' })
			return
		}
		const credential = await startAuthenticationFn({ optionsJSON: beginData.options })
		const deviceid = generateDeviceId()
		const completeRes = await webauthnLoginComplete(credential, beginData.authSessionToken, deviceid, powToken)
		if (!completeRes.ok) {
			const { value: errPayload } = await parseResponseBodyJson(completeRes)
			showLoginMessage(errPayload || {})
			return
		}
		await finalizePasskeyLoginRedirect()
	}
	catch (err) {
		if (err?.name === 'NotAllowedError')
			showLoginMessage({ i18nKey: 'auth.webauthn.errorCancelled' })
		else {
			console.error('WebAuthn login error:', err)
			import('https://esm.sh/@sentry/browser').then(Sentry => Sentry.captureException(err))
			showLoginMessage({ i18nKey: 'auth.error.loginError' })
		}
	}
	finally {
		isWebAuthnInProgress = false
	}
}

/**
 * 生成唯一的设备 ID。
 * @returns {string} - 设备 ID。
 */
function generateDeviceId() {
	let deviceId = localStorage.getItem('deviceId')
	if (!deviceId) {
		deviceId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
		localStorage.setItem('deviceId', deviceId)
	}
	return deviceId
}

/**
 * 处理发送验证码。
 * @returns {Promise<void>}
 */
async function handleSendVerificationCode() {
	if (sendCodeCooldown) return

	try {
		const response = await generateVerificationCode()

		if (response.ok) {
			showLoginMessage({ i18nKey: 'auth.error.verificationCodeSent' })
			verificationCodeSent = true
			sendCodeCooldown = true
			let timeLeft = 60
			sendVerificationCodeBtn.disabled = true
			sendVerificationCodeBtn.textContent = `${timeLeft}s`
			const countdown = setInterval(() => {
				timeLeft--
				sendVerificationCodeBtn.textContent = `${timeLeft}s`
				if (timeLeft <= 0) {
					clearInterval(countdown)
					sendVerificationCodeBtn.disabled = false
					sendVerificationCodeBtn.dataset.i18n = 'auth.sendCodeButton'
					sendCodeCooldown = false
				}
			}, 1000)
		}
		else if (response.status === 429)
			showLoginMessage({ i18nKey: 'auth.error.verificationCodeRateLimit' })
		else
			showLoginMessage({ i18nKey: 'auth.error.verificationCodeSendError' })
	}
	catch (err) {
		console.error('Error sending verification code:', err)
		showLoginMessage({ i18nKey: 'auth.error.verificationCodeSendError' })
	}
}

/**
 * 处理表单提交。
 * @param {SubmitEvent} event - 提交事件。
 * @returns {Promise<void>}
 */
async function handleFormSubmit(event) {
	event.preventDefault()

	const powToken = powCaptcha?.token
	if (!isLocalOrigin && !powToken) {
		showLoginMessage({ i18nKey: 'auth.error.powNotSolved' })
		return
	}

	const username = document.getElementById('username').value
	const password = passwordInput.value
	const deviceid = generateDeviceId()

	let verificationcode = ''
	if (!isLoginForm) {
		const confirmPassword = document.getElementById('confirm-password').value
		if (password !== confirmPassword) {
			showLoginMessage({ i18nKey: 'auth.error.passwordMismatch' })
			return
		}
		// Password strength check
		const { score } = passwordStrengthMeter.evaluate()
		if (score < 2) {
			showLoginMessage({ i18nKey: 'auth.error.lowPasswordStrength' })
			return // Prevent form submission
		}
		if (!isLocalOrigin) {
			if (!verificationCodeSent) {
				showLoginMessage({ i18nKey: 'auth.error.verificationCodeError' })
				return
			}
			verificationcode = document.getElementById('verification-code').value.trim()
			if (!verificationcode) {
				showLoginMessage({ i18nKey: 'auth.error.verificationCodeError' })
				return
			}
		}
	}

	try {
		let response
		if (isLoginForm)
			response = await login(username, password, deviceid, powToken)
		else
			response = await register(username, password, deviceid, verificationcode, powToken)

		if (response.ok) {
			if (isLoginForm)
				await finalizePasswordLoginRedirect()
			else toggleForm() // 注册成功后自动切换到登录表单
			return
		}
		const { value: errPayload } = await parseResponseBodyJson(response)
		showLoginMessage(errPayload ?? {})
	}
	catch (err) {
		console.error('Error during form submission:', err)
		showLoginMessage({
			i18nKey: isLoginForm ? 'auth.error.loginError' : 'auth.error.registrationError',
		})
	}
}

/**
 * 设置事件侦听器。
 * @returns {void}
 */
function setupEventListeners() {
	toggleLink.addEventListener('click', handleToggleClick)
	submitBtn.addEventListener('click', handleFormSubmit)
	sendVerificationCodeBtn.addEventListener('click', handleSendVerificationCode)
	webauthnLoginBtn.addEventListener('click', handleWebAuthnLogin)
}

/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
async function initializeApp() {
	localStorage.setItem('theme', localStorage.getItem('theme') || 'dark')
	const urlParams = new URLSearchParams(window.location.search)
	applyTheme()
	if (urlParams.get('theme')) setTheme(urlParams.get('theme'))
	await initTranslations('auth')
	if (urlParams.get('userPreferredLanguages')) savePreferredLangs(JSON.parse(urlParams.get('userPreferredLanguages')))

	const powCaptchaContainer = document.getElementById('pow-captcha-container')
	if (!isLocalOrigin) try {
		powCaptchaContainer.style.display = 'block'
		powCaptcha = await createPOWCaptcha(powCaptchaContainer)
	} catch (err) {
		console.error('POW captcha initialization error:', err)
		showLoginMessage({ i18nKey: 'auth.error.powError' })
	}

	passwordStrengthMeter = initPasswordStrengthMeter(passwordInput, passwordStrengthFeedback)
	setupEventListeners()

	initializeForm()
	onLanguageChange(refreshUIStrings)
	const autologinParam = urlParams.get('autologin') || urlParams.has('autologin')
	const usernameInput = document.getElementById('username')

	try {
		const hashParams = new URLSearchParams(window.location.hash.substring(1))
		const uuid = await ping().then(res => res.uuid)
		const from = hashParams.get('from')
		const fileId = hashParams.get('fileId')

		const plaintextCredentials = await retrieveAndDecryptCredentials(fileId, from, hashParams, uuid)

		if (plaintextCredentials) {
			const { username, password } = JSON.parse(plaintextCredentials)
			usernameInput.value = username
			passwordInput.value = password
		}
		else {
			// Legacy plaintext params
			const usernameParam = urlParams.get('username')
			const passwordParam = urlParams.get('password')
			if (usernameParam) usernameInput.value = usernameParam
			if (passwordParam) passwordInput.value = passwordParam
		}
	}
	catch (e) {
		console.error('Failed to obtain credentials for autologin.', e)
		showToast('error', e?.message || String(e))
		import('https://esm.sh/@sentry/browser').then(Sentry => Sentry.captureException(e))
	}
	finally {
		const hashParams = new URLSearchParams(window.location.hash.substring(1))
		hashParams.delete('uuid')
		hashParams.delete('from')
		hashParams.delete('fileId')
		hashParams.delete('encrypted_creds')
		window.location.hash = hashParams.toString()
	}

	if (JSON.parse(autologinParam)) {
		if (!isLoginForm) toggleForm()
		if (powCaptcha) try {
			submitBtn.disabled = true
			submitBtn.dataset.i18n = 'pow_captcha.verifying'
			await powCaptcha.solve()
		} catch (err) {
			console.error('POW captcha solve error:', err)
			showLoginMessage({ i18nKey: 'auth.error.powError' })
			return
		} finally {
			submitBtn.disabled = false
			updateFormDisplay()
		}
		submitBtn.click()
	}
}

// 执行初始化
try {
	await initializeApp()
	navigator.serviceWorker?.controller?.postMessage({ type: 'EXIT_COLD_BOOT' })
	runPreloadIfNotSaveData()
}
catch (error) {
	showToast('error', error.message)
	import('https://esm.sh/@sentry/browser').then(Sentry => Sentry.captureException(error))
}
