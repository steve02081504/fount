import { applyTheme } from '../scripts/theme.mjs'
import { initTranslations, geti18n } from '../scripts/i18n.mjs'

async function handleProtocol() {
	const urlParams = new URL(window.location.href)
	const protocol = urlParams.searchParams.get('url')

	if (!protocol || !protocol.startsWith('fount://')) {
		document.getElementById('message').textContent = geti18n('protocolhandler.invalidProtocol')
		return
	}

	const parts = protocol.substring(8).split('/')
	const command = parts[0]

	const authResponse = await fetch('/api/authenticate', {
		method: 'POST'
	})
	if (!authResponse.ok) {
		window.location.href = `/login?redirect=${encodeURIComponent(window.location.href)}`
		return
	}

	if (command === 'runshell')
		handleRunShell(parts)
	else if (command === 'page')
		handlePage(parts)
	else
		document.getElementById('message').textContent = geti18n('protocolhandler.unknownCommand')

}

async function handleRunShell(parts) {
	if (parts.length < 3) {
		document.getElementById('message').textContent = geti18n('protocolhandler.insufficientParams')
		return
	}
	const shellname = parts[1]
	const args = parts.slice(2).join('/').split(';').map(decodeURIComponent)
	try {
		const response = await fetch('/api/runshell', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ shellname, args }),
		})

		if (response.ok)
			document.getElementById('message').textContent = geti18n('protocolhandler.shellCommandSent')
		else
			document.getElementById('message').textContent = geti18n('protocolhandler.shellCommandFailed')

	} catch (error) {
		console.error('Error sending shell command:', error)
		document.getElementById('message').textContent = geti18n('protocolhandler.shellCommandError')
	}
	setTimeout(() => {
		if (history[history.length - 1].startsWith('https://steve02081504.github.io/fount/protocol'))
			if (history.length > 2)
				history.go(-2)
			else
				window.location.href = '/'
		else
			history.back()
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
