import { authenticate } from '../scripts/api/base.mjs'
import { runPart } from '../scripts/api/parts.mjs'
import { initTranslations, console } from '../scripts/i18n/index.mjs'
import { applyTheme } from '../scripts/theme/index.mjs'

const urlParams = new URL(window.location.href)
const gobackNum = Number(urlParams.searchParams.get('gobackNum') || 1)

/**
 * 处理协议。
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
		const selfUrl = new URL(window.location.href)
		selfUrl.searchParams.set('gobackNum', gobackNum + 1)
		window.location.href = `/login?redirect=${encodeURIComponent(selfUrl.href)}`
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
 * 处理运行部件。
 * @param {string[]} parts - 部件。
 * @returns {Promise<void>}
 */
async function handleRunPart(parts) {
	if (parts.length < 3) {
		document.getElementById('message').dataset.i18n = 'protocolhandler.insufficientParams'
		return
	}
	// `:` 是 part 路径分隔符（URL 形如 /parts/shells:chat），还原为 runPart/loadPart 路径 shells/chat。
	const partpath = parts[1].replaceAll(':', '/')
	const args = parts.slice(2).join('/').split(';').map(decodeURIComponent)

	const messageElement = document.getElementById('message')
	const progressElement = document.querySelector('.progress')

	const confirmed = await new Promise(resolve => {
		const confirmation_modal = document.getElementById('confirmation_modal')
		const confirmation_message = document.getElementById('confirmation_message')
		const confirmButton = document.getElementById('confirm_button')
		const cancelButton = document.getElementById('cancel_button')

		messageElement.style.display = 'none'
		progressElement.style.display = 'none'

		confirmation_message.dataset.i18n = 'protocolhandler.runPart.confirm.message'
		confirmation_message.dataset.partpath = partpath
		confirmation_modal.showModal()

		/**
		 * 确认按钮点击事件。
		 * @returns {void}
		 */
		confirmButton.onclick = () => {
			confirmation_modal.close()
			resolve(true)
		}
		/**
		 * 取消按钮点击事件。
		 * @returns {void}
		 */
		cancelButton.onclick = () => {
			confirmation_modal.close()
			resolve(false)
		}
	})

	/**
	 * 返回上一页。
	 * @returns {void}
	 */
	const goBack = () => {
		try {
			if (history.length > gobackNum) history.go(-gobackNum)
			else throw new Error('No history')
		}
		catch {
			window.location.href = '/'
		}
	}

	if (!confirmed) return goBack()

	messageElement.style.display = 'block'
	progressElement.style.display = 'block'
	messageElement.dataset.i18n = 'protocolhandler.processing'
	const errorActionsElement = document.getElementById('error_actions')
	const retryButton = document.getElementById('retry_button')
	const backButton = document.getElementById('back_button')

	/**
	 * 显示运行错误：隐藏进度条，显示错误信息与重试/返回按钮。
	 * @param {unknown} error - 错误对象。
	 * @returns {void}
	 */
	const showRunError = (error) => {
		progressElement.style.display = 'none'
		messageElement.dataset.i18n = 'protocolhandler.runPart.commandError'
		messageElement.dataset.error = String(error?.message ?? error)
		errorActionsElement.hidden = false
	}

	/**
	 * 运行部件并处理错误。
	 * @returns {Promise<void>}
	 */
	const doRun = async () => {
		try {
			await runPart(partpath, args)
			progressElement.style.display = 'none'
			messageElement.dataset.i18n = 'protocolhandler.runPart.commandSent'
			setTimeout(goBack, 2000)
		}
		catch (error) {
			console.errorI18n('protocolhandler.runPart.commandError', { error })
			showRunError(error)
		}
	}

	/**
	 * 重试按钮点击事件。
	 * @returns {void}
	 */
	retryButton.onclick = () => {
		errorActionsElement.hidden = true
		progressElement.style.display = 'block'
		messageElement.dataset.i18n = 'protocolhandler.processing'
		delete messageElement.dataset.error
		doRun()
	}
	backButton.onclick = goBack

	doRun()
}

/**
 * 处理页面。
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
