import { authenticate } from '../scripts/endpoints.mjs'
import { initTranslations, console } from '../scripts/i18n.mjs'
import { runPart } from '../scripts/parts.mjs'
import { applyTheme } from '../scripts/theme.mjs'

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
	const partpath = parts[1].replaceAll(':', '/')
	const args = parts.slice(2).join('/').split(';').map(decodeURIComponent)

	const messageEl = document.getElementById('message')
	const progressEl = document.querySelector('.progress')

	const confirmed = await new Promise(resolve => {
		const confirmation_modal = document.getElementById('confirmation_modal')
		const confirmation_message = document.getElementById('confirmation_message')
		const confirm_btn = document.getElementById('confirm_btn')
		const cancel_btn = document.getElementById('cancel_btn')

		messageEl.style.display = 'none'
		progressEl.style.display = 'none'

		confirmation_message.dataset.i18n = 'protocolhandler.runPart.confirm.message'
		confirmation_message.dataset.partpath = partpath
		confirmation_modal.showModal()

		/**
		 * 确认按钮点击事件。
		 * @returns {void}
		 */
		confirm_btn.onclick = () => {
			confirmation_modal.close()
			resolve(true)
		}
		/**
		 * 取消按钮点击事件。
		 * @returns {void}
		 */
		cancel_btn.onclick = () => {
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

	messageEl.style.display = 'block'
	progressEl.style.display = 'block'
	messageEl.dataset.i18n = 'protocolhandler.processing'
	const errorActionsEl = document.getElementById('error_actions')
	const retryBtn = document.getElementById('retry_btn')
	const backBtn = document.getElementById('back_btn')

	/**
	 * 显示运行错误：隐藏进度条，显示错误信息与重试/返回按钮。
	 * @param {unknown} error - 错误对象。
	 * @returns {void}
	 */
	const showRunError = (error) => {
		progressEl.style.display = 'none'
		messageEl.dataset.i18n = 'protocolhandler.runPart.commandError'
		messageEl.dataset.error = String(error?.message ?? error)
		errorActionsEl.hidden = false
	}

	/**
	 * 运行部件并处理错误。
	 * @returns {Promise<void>}
	 */
	const doRun = async () => {
		try {
			await runPart(partpath, args)
			progressEl.style.display = 'none'
			messageEl.dataset.i18n = 'protocolhandler.runPart.commandSent'
			setTimeout(goBack, 2000)
		}
		catch (error) {
			console.errorI18n('protocolhandler.runPart.commandError', { error })
			showRunError(error)
		}
	}

	retryBtn.onclick = () => {
		errorActionsEl.hidden = true
		progressEl.style.display = 'block'
		messageEl.dataset.i18n = 'protocolhandler.processing'
		delete messageEl.dataset.error
		doRun()
	}
	backBtn.onclick = goBack

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
