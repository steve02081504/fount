const form = document.getElementById('auth-form')
const formTitle = document.getElementById('form-title')
const submitBtn = document.getElementById('submit-btn')
const toggleLink = document.getElementById('toggle-link')
const confirmPasswordGroup = document.getElementById('confirm-password-group')

let isLoginForm = true

toggleLink.addEventListener('click', function (event) {
	event.preventDefault()
	isLoginForm = !isLoginForm

	if (isLoginForm) {
		formTitle.textContent = 'Login'
		submitBtn.textContent = 'Login'
		toggleLink.innerHTML = `Don't have an account? <a href="#">Create one now</a>`
		confirmPasswordGroup.style.display = 'none'
	} else {
		formTitle.textContent = 'Create Account'
		submitBtn.textContent = 'Create Account'
		toggleLink.innerHTML = `Already have an account? <a href="#">Login now</a>`
		confirmPasswordGroup.style.display = 'block'
	}
})

form.addEventListener('submit', async function (event) {
	event.preventDefault()

	const username = document.getElementById('username').value
	const password = document.getElementById('password').value

	if (isLoginForm) 
		// 登录逻辑
		try {
			const response = await fetch('/api/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ username, password })
			})

			const data = await response.json()

			if (response.ok) {
				// 登录成功，存储 token 并跳转到其他页面或更新 UI
				window.location.href = '/home'
				console.log('Login successful!')
			} else 
				// 登录失败，显示错误信息
				document.getElementById('error-message').textContent = data.message
			
		} catch (error) {
			console.error('Error during login:', error)
			document.getElementById('error-message').textContent = 'An error occurred during login.'
		}
	 else {
		// 注册逻辑
		const confirmPassword = document.getElementById('confirm-password').value

		if (password !== confirmPassword) {
			document.getElementById('error-message').textContent = 'Passwords do not match.'
			return
		}

		try {
			const response = await fetch('/api/register', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ username, password })
			})

			const data = await response.json()

			if (response.ok) {
				console.log('Registration successful!')
				window.location.href = '/login'
			} else 
				// 注册失败，显示错误信息
				document.getElementById('error-message').textContent = data.message
			
		} catch (error) {
			console.error('Error during registration:', error)
			document.getElementById('error-message').textContent = 'An error occurred during registration.'
		}
	}
})
