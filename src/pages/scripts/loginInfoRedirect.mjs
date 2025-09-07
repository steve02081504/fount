import { encrypt } from './crypto.mjs'
import { uploadToCatbox } from './catbox.mjs'

export async function redirectToLoginInfo(redirectUrl = '/login', username = null, password = null) {
	if (redirectUrl.startsWith('/')) redirectUrl = window.location.origin + redirectUrl

	try {
		const { uuid } = await fetch('/api/ping').then(res => res.json())
		if (!uuid) throw new Error('Could not fetch instance UUID.')

		const loginInfoUrl = new URL('https://steve02081504.github.io/fount/login_info/')
		loginInfoUrl.searchParams.set('redirect', encodeURIComponent(redirectUrl))

		const hashParams = new URLSearchParams()
		hashParams.set('uuid', uuid)

		// If credentials are provided, use the secure transfer method
		gene_credentials: if (username && password) {
			const credentials = { username, password }
			const encryptedData = await encrypt(JSON.stringify(credentials), uuid)

			// 1. Try Encrypted Clipboard
			try {
				await navigator.clipboard.writeText(encryptedData)
				loginInfoUrl.searchParams.set('from', 'clipboard_encrypted')
				loginInfoUrl.hash = hashParams.toString()
				window.location.href = loginInfoUrl.href
				break gene_credentials
			}
			catch (e) {
				console.warn('Encrypted clipboard transfer failed, falling back to Catbox.', e)
			}

			// 2. Fallback to Catbox
			try {
				const fileId = await uploadToCatbox(encryptedData, '1h')
				loginInfoUrl.searchParams.set('fileId', fileId)
				loginInfoUrl.hash = hashParams.toString()
				console.log(`Encrypted credentials uploaded to Catbox for transfer with fileId: ${fileId}`)
				window.location.href = loginInfoUrl.href
				break gene_credentials
			}
			catch (e) {
				console.warn('Catbox upload failed, falling back to URL hash.', e)
			}

			// 3. Fallback to URL Hash
			hashParams.set('encrypted_creds', encodeURIComponent(encryptedData))
			loginInfoUrl.hash = hashParams.toString()
			window.location.href = loginInfoUrl.href
		} else {
			// No credentials, just redirect to login_info with uuid in hash
			loginInfoUrl.hash = hashParams.toString()
			window.location.href = loginInfoUrl.href
		}
	}
	catch (e) {
		console.error('Could not fetch instance UUID for login_info redirect', e)
	}
	setTimeout(() => window.location.href = redirectUrl, 3000)
}
