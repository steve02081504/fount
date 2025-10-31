import { authenticate, runPart } from '../scripts/endpoints.mjs'
import { initTranslations, geti18n, console } from '../scripts/i18n.mjs'
import { applyTheme } from '../scripts/theme.mjs'

const urlParams = new URL(window.location.href)
const from = urlParams.searchParams.get('from')

/**
 * @description 处理协议。
 * @returns {Promise<void>}
 */
async function handleProtocol() {
	const protocol = urlParams.searchParams.get('url')

	if (!protocol || !protocol.startsWith('fount://')) {
		document.getElementById('message').dataset.i18n = 'protocolhandler.invalidProtocol'
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
		document.getElementById('message').dataset.i18n = 'protocolhandler.unknownCommand'
}

/**
 * @description 处理运行部件。
 * @param {string[]} parts - 部件。
 * @returns {Promise<void>}
 */
async function handleRunPart(parts) {
	if (parts.length < 3) {
		document.getElementById('message').dataset.i18n = 'protocolhandler.insufficientParams'
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

		/**
		 * @description 确认按钮点击事件。
		 * @returns {void}
		 */
		confirm_btn.onclick = () => {
			confirmation_modal.close()
			resolve(true)
		}
		/**
		 * @description 取消按钮点击事件。
		 * @returns {void}
		 */
		cancel_btn.onclick = () => {
			confirmation_modal.close()
			resolve(false)
		}
	})

	/**
	 * @description 返回上一页。
	 * @returns {void}
	 */
	const goBack = () => {
		try {
			if (from == 'jumppage')
				if (history.length > 2) history.go(-2)
				else throw new Error('No history')
			else history.back()
		}
		catch {
			window.location.href = '/'
		}
	}

	if (!confirmed) {
		goBack()
		return
	}

	messageEl.style.display = 'block'
	progressEl.style.display = 'block'
	messageEl.dataset.i18n = 'protocolhandler.processing'

	try {
		const response = await runPart(parttype, partname, args)

		if (response.ok)
			messageEl.dataset.i18n = 'protocolhandler.shellCommandSent'
		else
			messageEl.dataset.i18n = 'protocolhandler.shellCommandFailed'
	}
	catch (error) {
		console.error('Error sending shell command:', error)
		messageEl.dataset.i18n = 'protocolhandler.shellCommandError'
	}
	setTimeout(goBack, 1000)
}

/**
 * @description 处理页面。
 * @param {string[]} parts - 页面部分。
 * @returns {void}
 */
function handlePage(parts) {
	if (parts.length < 2) {
		document.getElementById('message').dataset.i18n = 'protocolhandler.insufficientParams'
		return
	}
	parts.shift()
	window.location.href = `/${parts.join('/')}`
}

applyTheme()
await initTranslations('protocolhandler')
handleProtocol()
