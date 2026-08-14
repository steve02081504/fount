import { authenticate } from '/scripts/endpoints/base.mjs'
import { completeOAuth } from '../src/endpoints.mjs'
import { geti18n, initTranslations, setElementI18n } from '/scripts/i18n/index.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'

const message = document.getElementById('message')

/**
 * 完成 callback 页上的换票。
 * @returns {Promise<void>}
 */
async function main() {
	applyTheme()
	await initTranslations('oauth_handler')
	const authResponse = await authenticate()
	if (!authResponse.ok) {
		window.location.href = `/login?redirect=${encodeURIComponent(window.location.href)}`
		return
	}
	const searchParameters = new URL(window.location.href).searchParams
	const error = searchParameters.get('error')
	if (error) {
		setElementI18n(message, 'oauth_handler.callback.failed', { message: error })
		return
	}
	const code = searchParameters.get('code')
	const state = searchParameters.get('state')
	if (!code || !state) {
		setElementI18n(message, 'oauth_handler.callback.missingParams')
		return
	}
	try {
		await completeOAuth({ state, code })
		message.textContent = geti18n('oauth_handler.callback.success')
	}
	catch (error) {
		setElementI18n(message, 'oauth_handler.callback.failed', { message: error.message })
	}
}

await main()
