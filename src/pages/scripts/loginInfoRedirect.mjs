export async function redirectToLoginInfo(redirectUrl = '/login', username = null, password = null) {
	if (redirectUrl.startsWith('/')) redirectUrl = window.location.origin + redirectUrl
	try {
		const { uuid } = await fetch('/api/ping').then(res => res.json())
		if (uuid) {
			const loginInfoUrl = new URL('https://steve02081504.github.io/fount/login_info/')
			loginInfoUrl.searchParams.set('uuid', uuid)
			if (username && password) {
				loginInfoUrl.searchParams.set('username', username)
				loginInfoUrl.searchParams.set('password', password)
			}
			if (redirectUrl) loginInfoUrl.searchParams.set('redirect', encodeURIComponent(redirectUrl))
			window.location.href = loginInfoUrl.href
		}
	}
	catch (e) {
		console.error('Could not fetch instance UUID for login_info redirect', e)
	}
	setTimeout(() => window.location.href = redirectUrl, 3000)
}
