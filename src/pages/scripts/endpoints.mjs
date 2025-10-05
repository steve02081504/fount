export async function ping(with_cache = false) {
	const response = await fetch('/api/ping', { cache: with_cache ? 'default' : 'no-cache' })
	return response.json()
}

export async function hosturl_in_local_ip() {
	return ping(1).then(data => data.hosturl_in_local_ip).catch(() => window.location.origin)
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

export async function login(username, password, deviceid, powToken) {
	return await fetch('/api/login', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ username, password, deviceid, powToken }),
	})
}

export async function register(username, password, deviceid, verificationcode, powToken) {
	return await fetch('/api/register', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ username, password, deviceid, verificationcode, powToken }),
	})
}

export async function authenticate() {
	return await fetch('/api/authenticate', {
		method: 'POST'
	})
}

export async function runPart(parttype, partname, args) {
	return await fetch('/api/runpart', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ parttype, partname, args }),
	})
}

export async function getUserSetting(key) {
	const response = await fetch(`/api/getusersetting?key=${encodeURIComponent(key)}`)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	const { value } = await response.json()
	return value
}

export async function setUserSetting(key, value) {
	return await fetch('/api/setusersetting', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ key, value }),
	})
}
