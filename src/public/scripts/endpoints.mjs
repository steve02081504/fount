export async function ping() {
	const response = await fetch('/api/ping')
	return response.json()
}

export async function generateVerificationCode() {
	return await fetch('/api/register/generateverificationcode', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
	})
}

export async function whoami() {
	const response = await fetch('/api/whoami')
	return response.json()
}

export async function login(username, password, deviceid) {
	return await fetch('/api/login', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ username, password, deviceid }),
	})
}

export async function register(username, password, deviceid, verificationcode) {
	return await fetch('/api/register', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ username, password, deviceid, verificationcode }),
	})
}

export async function authenticate() {
	return await fetch('/api/authenticate', {
		method: 'POST'
	})
}

export async function runShell(shellname, args) {
	return await fetch('/api/runshell', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ shellname, args }),
	})
}
