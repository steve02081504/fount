import { applyTheme } from '../scripts/theme.mjs'
import { initTranslations, geti18n } from '../scripts/i18n.mjs'
import { authenticate, runPart } from '../scripts/endpoints.mjs'

const urlParams = new URL(window.location.href)
const from = urlParams.searchParams.get('from')

async function handleProtocol() {
	const protocol = urlParams.searchParams.get('url')

	if (!protocol || !protocol.startsWith('fount://')) {
		document.getElementById('message').textContent = geti18n('protocolhandler.invalidProtocol')
		return
	}

	const parts = protocol.substring(8).split('/')
	const command = parts[0]

	const authResponse = await authenticate()
	if (!authResponse.ok) {
		window.location.href = `/login?redirect=${encodeURIComponent(window.location.href)}`
		return
	}

	if (command === 'run')
		handleRunPart(parts)
	else if (command === 'page')
		handlePage(parts)
	else
		document.getElementById('message').textContent = geti18n('protocolhandler.unknownCommand')
}

async function handleRunPart(parts) {
	if (parts.length < 3) {
		document.getElementById('message').textContent = geti18n('protocolhandler.insufficientParams')
		return
	}
	const parttype = parts[1]
	const partname = parts[2]
	const args = parts.slice(3).join('/').split(';').map(decodeURIComponent)
	try {
		const response = await runPart(parttype, partname, args)

		if (response.ok)
			document.getElementById('message').textContent = geti18n('protocolhandler.shellCommandSent')
		else
			document.getElementById('message').textContent = geti18n('protocolhandler.shellCommandFailed')
	} catch (error) {
		console.error('Error sending shell command:', error)
		document.getElementById('message').textContent = geti18n('protocolhandler.shellCommandError')
	}
	setTimeout(() => {
		try {
			if (from == 'jumppage')
				if (history.length > 2) history.go(-2)
				else throw new Error('No history')
			else history.back()
		} catch (_) {
			window.location.href = '/'
		}
	}, 1000)
}

function handlePage(parts) {
	if (parts.length < 2) {
		document.getElementById('message').textContent = geti18n('protocolhandler.insufficientParams')
		return
	}
	parts.shift()
	window.location.href = `/${parts.join('/')}`
}

applyTheme()
await initTranslations('protocolhandler')
handleProtocol()
