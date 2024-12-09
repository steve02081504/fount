const form = document.getElementById('auth-form')
const formTitle = document.getElementById('form-title')
const formSubtitle = document.getElementById('form-subtitle')
const submitBtn = document.getElementById('submit-btn')
const toggleLink = document.getElementById('toggle-link')
const confirmPasswordGroup = document.getElementById('confirm-password-group')
const errorMessage = document.getElementById('error-message')

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
	},
}

let isLoginForm = true

// 初始化表单状态
function initializeForm() {
	toggleForm() // 确保初始状态正确
}

// 切换表单类型（登录/注册）
function handleToggleClick(event) {
	event.preventDefault()
	toggleForm()
}

function toggleForm() {
	isLoginForm = !isLoginForm
	const currentForm = isLoginForm ? formContent.login : formContent.register

	formTitle.textContent = currentForm.title
	formSubtitle.textContent = currentForm.subtitle
	submitBtn.textContent = currentForm.submitBtn
	toggleLink.innerHTML = `${currentForm.toggleLink.text}<a href="#" class="link link-primary">${currentForm.toggleLink.link}</a>`
	confirmPasswordGroup.style.display = isLoginForm ? 'none' : 'flex'
	errorMessage.textContent = ''
}

// 处理表单提交
async function handleFormSubmit(event) {
	event.preventDefault()

	const username = document.getElementById('username').value
	const password = document.getElementById('password').value

	if (!isLoginForm) {
		const confirmPassword = document.getElementById('confirm-password').value
		if (password !== confirmPassword) {
			errorMessage.textContent = formContent.error.passwordMismatch
			return
		}
	}

	const endpoint = isLoginForm ? '/api/login' : '/api/register'
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ username, password }),
		})

		const data = await response.json()

		if (response.ok)
			if (isLoginForm) {
				console.log('Login successful!')
				window.location.href = '/home'
			} else {
				console.log('Registration successful!')
				toggleForm() // Automatically switch to login form after successful registration
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
	form.addEventListener('submit', handleFormSubmit)
}

// 设置主题
function setTheme() {
	const prefersDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
	document.documentElement.setAttribute('data-theme', prefersDarkMode ? 'dark' : 'light')
}

// 页面加载完成后的初始化工作
function initializeApp() {
	setTheme()
	initializeForm()
	setupEventListeners()
}

// 执行初始化
initializeApp()
