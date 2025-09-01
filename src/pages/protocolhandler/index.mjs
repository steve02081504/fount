import { authenticate, runPart } from '../scripts/endpoints.mjs'
import { initTranslations, geti18n, console } from '../scripts/i18n.mjs'
import { applyTheme } from '../scripts/theme.mjs'

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

	const messageEl = document.getElementById('message')
	const progressEl = document.querySelector('.progress')

	const confirmed = await new Promise(resolve => {
		const confirmation_modal = document.getElementById('confirmation_modal')
		const confirmation_message = document.getElementById('confirmation_message')
		const confirm_btn = document.getElementById('confirm_btn')
		const cancel_btn = document.getElementById('cancel_btn')

		messageEl.style.display = 'none'
		progressEl.style.display = 'none'

		confirmation_message.textContent = geti18n('protocolhandler.runPartConfirm.message', { parttype, partname })
		confirmation_modal.showModal()

		confirm_btn.onclick = () => {
			confirmation_modal.close()
			resolve(true)
		}
		cancel_btn.onclick = () => {
			confirmation_modal.close()
			resolve(false)
		}
	})

	const goBack = () => {
		try {
			if (from == 'jumppage')
				if (history.length > 2) history.go(-2)
				else throw new Error('No history')
			else history.back()
		} catch (_) {
			window.location.href = '/'
		}
	}

	if (!confirmed) {
		goBack()
		return
	}

	messageEl.style.display = 'block'
	progressEl.style.display = 'block'
	messageEl.textContent = geti18n('protocolhandler.processing')

	try {
		const response = await runPart(parttype, partname, args)

		if (response.ok)
			messageEl.textContent = geti18n('protocolhandler.shellCommandSent')
		else
			messageEl.textContent = geti18n('protocolhandler.shellCommandFailed')
	} catch (error) {
		console.error('Error sending shell command:', error)
		messageEl.textContent = geti18n('protocolhandler.shellCommandError')
	}
	setTimeout(goBack, 1000)
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
