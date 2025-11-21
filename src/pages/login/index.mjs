import { retrieveAndDecryptCredentials, redirectToLoginInfo } from '../scripts/credentialManager.mjs'
import { ping, generateVerificationCode, login, register } from '../scripts/endpoints.mjs'
import { initTranslations, console, savePreferredLangs, onLanguageChange } from '../scripts/i18n.mjs'
import { getAnyDefaultPart } from '../scripts/parts.mjs'
import { initPasswordStrengthMeter } from '../scripts/passwordStrength.mjs'
import { createPOWCaptcha } from '../scripts/POWcaptcha.mjs'
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

const isLocalOrigin = await ping().then(data => data.is_local_ip).catch(() => false)

let isLoginForm = true
let verificationCodeSent = false
let sendCodeCooldown = false
let powCaptcha = null
let passwordStrengthMeter = null

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
	passwordInput.autocomplete = isLoginForm ? 'current-password' : 'new-password'
	errorMessage.textContent = ''

	if (isLoginForm) {
		verificationCodeSent = false
		sendVerificationCodeBtn.disabled = false
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
			errorMessage.dataset.i18n = 'auth.error.verificationCodeSent'
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
			errorMessage.dataset.i18n = 'auth.error.verificationCodeRateLimit'
		else
			errorMessage.dataset.i18n = 'auth.error.verificationCodeSendError'
	}
	catch (error) {
		console.error('Error sending verification code:', error)
		errorMessage.dataset.i18n = 'auth.error.verificationCodeSendError'
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
		errorMessage.dataset.i18n = 'auth.error.powNotSolved'
		return
	}

	const username = document.getElementById('username').value
	const password = passwordInput.value
	const deviceid = generateDeviceId()

	let verificationcode = ''
	if (!isLoginForm) {
		const confirmPassword = document.getElementById('confirm-password').value
		if (password !== confirmPassword) {
			errorMessage.dataset.i18n = 'auth.error.passwordMismatch'
			return
		}
		// Password strength check
		const { score } = passwordStrengthMeter.evaluate()
		if (score < 2) {
			errorMessage.dataset.i18n = 'auth.error.lowPasswordStrength'
			return // Prevent form submission
		}
		if (!isLocalOrigin) {
			if (!verificationCodeSent) {
				errorMessage.dataset.i18n = 'auth.error.verificationCodeError'
				return
			}
			verificationcode = document.getElementById('verification-code').value.trim()
			if (!verificationcode) {
				errorMessage.dataset.i18n = 'auth.error.verificationCodeError'
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

		const data = await response.json()

		if (response.ok)
			if (isLoginForm) {
				const urlParams = new URLSearchParams(window.location.search)
				const redirect = urlParams.get('redirect')
				const defaultShell = await getAnyDefaultPart('shells') || 'home' // Fallback to 'home' if no default shell is set

				let finalRedirectUrl
				if (redirect)
					finalRedirectUrl = decodeURIComponent(redirect)
				else
					finalRedirectUrl = `/shells/${defaultShell}`

				redirectToLoginInfo(finalRedirectUrl + window.location.hash, username, password)
			}
			else toggleForm() // 注册成功后自动切换到登录表单
		else
			errorMessage.textContent = data.message
	}
	catch (error) {
		console.error('Error during form submission:', error)
		errorMessage.dataset.i18n = isLoginForm
			? 'auth.error.loginError'
			: 'auth.error.registrationError'
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
		errorMessage.dataset.i18n = 'auth.error.powError'
		console.error(err)
	}

	passwordStrengthMeter = initPasswordStrengthMeter(passwordInput, passwordStrengthFeedback)
	setupEventListeners()

	initializeForm()
	onLanguageChange(refreshUIStrings)
	const autologinParam = urlParams.get('autologin') || urlParams.has('autologin')
	const usernameInput = document.getElementById('username')

	try {
		const hashParams = new URLSearchParams(window.location.hash.substring(1))
		const uuid = hashParams.get('uuid')
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
	}
	finally {
		const hashParams = new URLSearchParams(window.location.hash.substring(1))
		hashParams.delete('uuid')
		hashParams.delete('from')
		hashParams.delete('fileId')
		window.location.hash = hashParams.toString()
	}

	if (JSON.parse(autologinParam)) {
		if (!isLoginForm) toggleForm()
		if (powCaptcha) try {
			submitBtn.disabled = true
			submitBtn.dataset.i18n = 'pow_captcha.verifying'
			await powCaptcha.solve()
		} catch (err) {
			errorMessage.dataset.i18n = 'auth.error.powError'
			console.error(err)
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
	initializeApp()
	navigator.serviceWorker?.controller?.postMessage({ type: 'EXIT_COLD_BOOT' })
}
catch (error) {
	showToast('error', error.message)
	import('https://esm.sh/@sentry/browser').then(Sentry => Sentry.captureException(error))
}
