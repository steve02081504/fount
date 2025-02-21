import { applyTheme } from '../scripts/theme.mjs'

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


const isLocalOrigin = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

const formContent = {
	login: {
		title: 'Login',
		subtitle: 'User data will be stored in local storage',
		submitBtn: 'Login',
		toggleLink: {
			text: 'Don\'t have an account? ',
			link: 'Create one now',
		},
	},
	register: {
		title: 'Create Account',
		subtitle: 'User data will be stored in local storage',
		submitBtn: 'Create Account',
		toggleLink: {
			text: 'Already have an account? ',
			link: 'Login now',
		},
	},
	error: {
		passwordMismatch: 'Passwords do not match.',
		loginError: 'An error occurred during login.',
		registrationError: 'An error occurred during registration.',
		verificationCodeError: 'Verification code error or expired.',
		verificationCodeSent: 'Verification code sent successfully.',
		verificationCodeSendError: 'Failed to send verification code.',
		verificationCodeRateLimit: 'Sending verification code too frequently. Please try again later.',
		lowPasswordStrength: 'Password strength too low.',
	},
	passwordStrength: {
		veryWeak: 'Very Weak',
		weak: 'Weak',
		normal: 'Normal',
		strong: 'Strong',
		veryStrong: 'Very Strong',
	},
}

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
			feedbackText = formContent.passwordStrength.veryWeak
			break
		case 1:
			borderColorClass = 'border-orange-500'
			feedbackText = formContent.passwordStrength.weak
			break
		case 2:
			borderColorClass = 'border-yellow-500'
			feedbackText = formContent.passwordStrength.normal
			break
		case 3:
			borderColorClass = 'border-lime-500'
			feedbackText = formContent.passwordStrength.strong
			break
		case 4:
			borderColorClass = 'border-green-500'
			feedbackText = formContent.passwordStrength.veryStrong
			break
	}
	let fullFeedback = `<strong>${feedbackText}</strong><br/>`
	if (result.feedback.warning) fullFeedback += result.feedback.warning + '<br/>'
	if (result.feedback.suggestions) fullFeedback += result.feedback.suggestions.join('<br/>')

	return { borderColorClass, fullFeedback }
}

function updateFormDisplay() {
	const currentForm = isLoginForm ? formContent.login : formContent.register

	formTitle.textContent = currentForm.title
	formSubtitle.textContent = currentForm.subtitle
	submitBtn.textContent = currentForm.submitBtn
	toggleLink.innerHTML = `${currentForm.toggleLink.text}<a href="#" class="link link-primary">${currentForm.toggleLink.link}</a>`
	confirmPasswordGroup.style.display = isLoginForm ? 'none' : 'flex'
	if (isLocalOrigin) verificationCodeGroup.style.display = 'none'
	else verificationCodeGroup.style.display = isLoginForm ? 'none' : 'flex'
	errorMessage.textContent = ''
	if (isLoginForm) {
		verificationCodeSent = false
		sendVerificationCodeBtn.disabled = false
		sendVerificationCodeBtn.textContent = 'Send Code'
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
		const response = await fetch('/api/register/generateverificationcode', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
		})

		if (response.ok) {
			errorMessage.textContent = formContent.error.verificationCodeSent
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
					sendVerificationCodeBtn.textContent = 'Send Code'
					sendCodeCooldown = false
				}
			}, 1000)
		} else if (response.status === 429)
			errorMessage.textContent = formContent.error.verificationCodeRateLimit
		else
			errorMessage.textContent = formContent.error.verificationCodeSendError

	} catch (error) {
		console.error('Error sending verification code:', error)
		errorMessage.textContent = formContent.error.verificationCodeSendError
	}
}

// 处理表单提交
async function handleFormSubmit(event) {
	event.preventDefault()

	const username = document.getElementById('username').value
	const password = document.getElementById('password').value
	const deviceid = generateDeviceId()

	let verificationcode = ''
	if (!isLoginForm) {
		const confirmPassword = document.getElementById('confirm-password').value
		if (password !== confirmPassword) {
			errorMessage.textContent = formContent.error.passwordMismatch
			return
		}
		// 密码强度检查
		const { borderColorClass, fullFeedback } = evaluatePasswordStrength(password)
		if (borderColorClass === 'border-red-500' || borderColorClass === 'border-orange-500') {
			errorMessage.textContent = formContent.error.lowPasswordStrength
			return // 阻止表单提交
		}
		if (!isLocalOrigin) {
			if (!verificationCodeSent) {
				errorMessage.textContent = formContent.error.verificationCodeError
				return
			}
			verificationcode = document.getElementById('verification-code').value.trim()
			if (!verificationcode) {
				errorMessage.textContent = formContent.error.verificationCodeError
				return
			}
		}
	}

	const endpoint = isLoginForm ? '/api/login' : '/api/register'
	try {
		const body = isLoginForm
			? JSON.stringify({ username, password, deviceid })
			: JSON.stringify({ username, password, deviceid, verificationcode })
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body,
		})

		const data = await response.json()

		if (response.ok)
			if (isLoginForm) {
				console.log('Login successful!')
				// 跳转参数？
				const urlParams = new URLSearchParams(window.location.search)
				const redirect = urlParams.get('redirect')
				if (redirect) window.location.href = decodeURIComponent(redirect)
				else {
					localStorage.setItem('hasLoggedIn', 'true')
					window.location.href = `/shells/${hasLoggedIn ? 'home' : 'tutorial'}`
				}
			} else {
				console.log('Registration successful!')
				toggleForm() // 注册成功后自动切换到登录表单
			}
		else
			errorMessage.textContent = data.message
	} catch (error) {
		console.error('Error during form submission:', error)
		errorMessage.textContent = isLoginForm
			? formContent.error.loginError
			: formContent.error.registrationError
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
function initializeApp() {
	applyTheme()
	initializeForm()
	setupEventListeners()
}

// 执行初始化
initializeApp()
