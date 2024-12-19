import { applyTheme } from "../scripts/theme.mjs"

const form = document.getElementById('auth-form')
const formTitle = document.getElementById('form-title')
const formSubtitle = document.getElementById('form-subtitle')
const submitBtn = document.getElementById('submit-btn')
const toggleLink = document.getElementById('toggle-link')
const confirmPasswordGroup = document.getElementById('confirm-password-group')
const errorMessage = document.getElementById('error-message')
const verificationCodeGroup = document.getElementById('verification-code-group')
const sendVerificationCodeBtn = document.getElementById('send-verification-code-btn')

const formContent = {
	login: {
		title: 'Login',
		subtitle: 'User data will be stored in local storage',
		submitBtn: 'Login',
		toggleLink: {
			text: "Don't have an account? ",
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
	},
}

let isLoginForm = true
let verificationCodeSent = false
let sendCodeCooldown = false

let hasLoggedIn = localStorage.getItem('hasLoggedIn') == 'true'

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

function updateFormDisplay() {
	const currentForm = isLoginForm ? formContent.login : formContent.register

	formTitle.textContent = currentForm.title
	formSubtitle.textContent = currentForm.subtitle
	submitBtn.textContent = currentForm.submitBtn
	toggleLink.innerHTML = `${currentForm.toggleLink.text}<a href="#" class="link link-primary">${currentForm.toggleLink.link}</a>`
	confirmPasswordGroup.style.display = isLoginForm ? 'none' : 'flex'
	verificationCodeGroup.style.display = isLoginForm ? 'none' : 'flex'
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

	if (!isLoginForm) {
		const confirmPassword = document.getElementById('confirm-password').value
		if (password !== confirmPassword) {
			errorMessage.textContent = formContent.error.passwordMismatch
			return
		}
		if (!verificationCodeSent) {
			errorMessage.textContent = formContent.error.verificationCodeError
			return
		}
		const verificationCode = document.getElementById('verification-code').value
		if (!verificationCode) {
			errorMessage.textContent = formContent.error.verificationCodeError
			return
		}
	}

	const endpoint = isLoginForm ? '/api/login' : '/api/register'
	try {
		const body = isLoginForm
			? JSON.stringify({ username, password, deviceid })
			: JSON.stringify({ username, password, deviceid, verificationcode: document.getElementById('verification-code').value })
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
				localStorage.setItem('hasLoggedIn', 'true')
				window.location.href = hasLoggedIn ? '/home' : '/tutorial'
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
