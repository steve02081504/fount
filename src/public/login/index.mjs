import { applyTheme } from '../scripts/theme.mjs'
import { initTranslations, geti18n } from '../scripts/i18n.mjs'
import { ping, generateVerificationCode, login, register } from '../scripts/endpoints.mjs'

const form = document.getElementById('auth-form')
const formTitle = document.getElementById('form-title')
const formSubtitle = document.getElementById('form-subtitle')
const submitBtn = document.getElementById('submit-btn')
const toggleLink = document.getElementById('toggle-link')
const confirmPasswordGroup = document.getElementById('confirm-password-group')
const errorMessage = document.getElementById('error-message')
const verificationCodeGroup = document.getElementById('verification-code-group')
const sendVerificationCodeBtn = document.getElementById('send-verification-code-btn')
const passwordStrengthFeedback = document.getElementById('password-strength-feedback')
const passwordInput = document.getElementById('password')

const isLocalOrigin = await ping().then(res => res.json()).then(data => data.is_local_ip).catch(() => false)

let isLoginForm = true
let verificationCodeSent = false
let sendCodeCooldown = false

const hasLoggedIn = localStorage.getItem('hasLoggedIn') == 'true'

// 初始化表单状态
function initializeForm() {
	isLoginForm = hasLoggedIn
	updateFormDisplay()
}

function toggleForm() {
	isLoginForm = !isLoginForm
	updateFormDisplay()
}

// 切换表单类型（登录/注册）
function handleToggleClick(event) {
	event.preventDefault()
	toggleForm()
}

function evaluatePasswordStrength(password) {
	const result = zxcvbn(password)
	let feedbackText = ''
	let borderColorClass = ''

	switch (result.score) {
		case 0:
			borderColorClass = 'border-red-500'
			feedbackText = geti18n('auth.passwordStrength.veryWeak')
			break
		case 1:
			borderColorClass = 'border-orange-500'
			feedbackText = geti18n('auth.passwordStrength.weak')
			break
		case 2:
			borderColorClass = 'border-yellow-500'
			feedbackText = geti18n('auth.passwordStrength.normal')
			break
		case 3:
			borderColorClass = 'border-lime-500'
			feedbackText = geti18n('auth.passwordStrength.strong')
			break
		case 4:
			borderColorClass = 'border-green-500'
			feedbackText = geti18n('auth.passwordStrength.veryStrong')
			break
	}
	let fullFeedback = `<strong>${feedbackText}</strong><br/>`
	if (result.feedback.warning) fullFeedback += result.feedback.warning + '<br/>'
	if (result.feedback.suggestions) fullFeedback += result.feedback.suggestions.join('<br/>')

	return { borderColorClass, fullFeedback }
}

function updateFormDisplay() {
	const formType = isLoginForm ? 'login' : 'register'

	formTitle.textContent = geti18n(`auth.${formType}.title`)
	submitBtn.textContent = geti18n(`auth.${formType}.submitButton`)
	toggleLink.innerHTML = `${geti18n(`auth.${formType}.toggleLink.text`)}<a href="#" class="link link-primary">${geti18n(`auth.${formType}.toggleLink.link`)}</a>`

	confirmPasswordGroup.style.display = isLoginForm ? 'none' : 'block'
	verificationCodeGroup.style.display = isLoginForm || isLocalOrigin ? 'none' : 'block'
	passwordInput.autocomplete = isLoginForm ? 'current-password' : 'new-password'
	errorMessage.textContent = ''

	if (isLoginForm) {
		verificationCodeSent = false
		sendVerificationCodeBtn.disabled = false
	}
}

// 生成唯一的设备 ID
function generateDeviceId() {
	let deviceId = localStorage.getItem('deviceId')
	if (!deviceId) {
		deviceId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
		localStorage.setItem('deviceId', deviceId)
	}
	return deviceId
}

// 处理发送验证码
async function handleSendVerificationCode() {
	if (sendCodeCooldown) return

	try {
		const response = await generateVerificationCode()

		if (response.ok) {
			errorMessage.textContent = geti18n('auth.error.verificationCodeSent')
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
					sendVerificationCodeBtn.textContent = geti18n('auth.sendCodeButton')
					sendCodeCooldown = false
				}
			}, 1000)
		} else if (response.status === 429)
			errorMessage.textContent = geti18n('auth.error.verificationCodeRateLimit')
		else
			errorMessage.textContent = geti18n('auth.error.verificationCodeSendError')

	} catch (error) {
		console.error('Error sending verification code:', error)
		errorMessage.textContent = geti18n('auth.error.verificationCodeSendError')
	}
}

// 处理表单提交
async function handleFormSubmit(event) {
	event.preventDefault()

	const username = document.getElementById('username').value
	const password = passwordInput.value
	const deviceid = generateDeviceId()

	let verificationcode = ''
	if (!isLoginForm) {
		const confirmPassword = document.getElementById('confirm-password').value
		if (password !== confirmPassword) {
			errorMessage.textContent = geti18n('auth.error.passwordMismatch')
			return
		}
		// 密码强度检查
		const { borderColorClass, fullFeedback } = evaluatePasswordStrength(password)
		if (borderColorClass === 'border-red-500' || borderColorClass === 'border-orange-500') {
			errorMessage.textContent = geti18n('auth.error.lowPasswordStrength')
			return // 阻止表单提交
		}
		if (!isLocalOrigin) {
			if (!verificationCodeSent) {
				errorMessage.textContent = geti18n('auth.error.verificationCodeError')
				return
			}
			verificationcode = document.getElementById('verification-code').value.trim()
			if (!verificationcode) {
				errorMessage.textContent = geti18n('auth.error.verificationCodeError')
				return
			}
		}
	}

	try {
		let response
		if (isLoginForm) {
			response = await login(username, password, deviceid)
		} else {
			response = await register(username, password, deviceid, verificationcode)
		}

		const data = await response.json()

		if (response.ok)
			if (isLoginForm) {
				console.log('Login successful!')
				// 跳转参数？
				const urlParams = new URLSearchParams(window.location.search)
				const redirect = urlParams.get('redirect')
				localStorage.setItem('hasLoggedIn', 'true')
				if (redirect)
					if (hasLoggedIn)
						window.location.href = decodeURIComponent(redirect) + window.location.hash
					else
						window.location.href = `/shells/tutorial?redirect=${redirect}` + window.location.hash
				else
					window.location.href = `/shells/${hasLoggedIn ? 'home' : 'tutorial'}`

			} else {
				console.log('Registration successful!')
				toggleForm() // 注册成功后自动切换到登录表单
			}
		else
			errorMessage.textContent = data.message
	} catch (error) {
		console.error('Error during form submission:', error)
		errorMessage.textContent = isLoginForm
			? geti18n('auth.error.loginError')
			: geti18n('auth.error.registrationError')
	}
}

// 设置事件监听器
function setupEventListeners() {
	const passwordInput = document.getElementById('password')
	passwordInput.addEventListener('input', () => {
		const { borderColorClass, fullFeedback } = evaluatePasswordStrength(passwordInput.value)

		// 更新边框颜色
		passwordInput.classList.remove('border-red-500', 'border-orange-500', 'border-yellow-500', 'border-lime-500', 'border-green-500')
		passwordInput.classList.add(borderColorClass)

		// 更新密码强度提示文字
		passwordStrengthFeedback.innerHTML = fullFeedback
		passwordStrengthFeedback.classList.remove('text-red-500', 'text-orange-500', 'text-yellow-500', 'text-lime-500', 'text-green-500')
		passwordStrengthFeedback.classList.add(borderColorClass.replace('border-', 'text-'))
	})
	toggleLink.addEventListener('click', handleToggleClick)
	submitBtn.addEventListener('click', handleFormSubmit)
	sendVerificationCodeBtn.addEventListener('click', handleSendVerificationCode)
}

// 页面加载完成后的初始化工作
async function initializeApp() {
	localStorage.setItem('theme', localStorage.getItem('theme') || 'dark')
	applyTheme()
	await initTranslations('auth')
	initializeForm()
	setupEventListeners()
}

// 执行初始化
initializeApp().catch(error => {
	alert(error.message)
	window.location.href = '/login'
})
