import { initTranslations, geti18n } from '../../../scripts/i18n.mjs'
import * as partsApi from '../../../scripts/parts.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast } from '../../../scripts/toast.mjs'

import * as api from './src/endpoints.mjs'

const pagesListDiv = document.getElementById('connected-pages-list'),
	scriptUrlInput = document.getElementById('script-url-input'),
	copyScriptUrlButton = document.getElementById('copy-script-url-button'),
	autorunScriptForm = document.getElementById('autorun-script-form'),
	autorunComment = document.getElementById('autorun-comment'),
	autorunUrlRegex = document.getElementById('autorun-url-regex'),
	autorunScript = document.getElementById('autorun-script'),
	autorunScriptList = document.getElementById('autorun-script-list'),
	viewScriptModal = document.getElementById('view-script-modal'),
	viewScriptModalTitle = document.getElementById('view-script-modal-title'),
	viewScriptModalContent = document.getElementById('view-script-modal-content')

let lastPages = ''
const autoRunScriptsCache = new Map()

async function renderPages(pages) {
	pagesListDiv.innerHTML = ''
	if (pages.length === 0) pagesListDiv.appendChild(await renderTemplate('empty_state'))
	else pagesListDiv.appendChild(await renderTemplate('page_table', { pages }))
}

async function fetchAndRenderPages() {
	try {
		const result = await api.getConnectedPages()
		if (!result.success) throw new Error(result.message)

		const newPagesJson = JSON.stringify(result.data)
		if (lastPages === newPagesJson) return

		lastPages = newPagesJson
		await renderPages(result.data)
	} catch (error) {
		lastPages = ''
		console.error('Failed to fetch and render pages:', error)
		pagesListDiv.innerHTML = ''
		pagesListDiv.appendChild(await renderTemplate('error_message'))
	}
}



function showViewScriptModal(scriptId) {
	const script = autoRunScriptsCache.get(scriptId)
	if (!script) return

	viewScriptModalTitle.textContent = script.comment || geti18n('browser_integration.autorun.view_script_modal_title')
	viewScriptModalContent.textContent = script.script // textContent is safe for displaying code
    
	viewScriptModal.showModal()
}

async function handleDeleteScript(scriptId) {
	if (!confirm(geti18n('browser_integration.autorun.confirm_delete'))) return
	try {
		// 1. Delete metadata from server
		const deleteResult = await api.deleteAutoRunScript(scriptId)
		if (!deleteResult.success) throw new Error(deleteResult.message)

		// 2. Dispatch event to userscript
		window.dispatchEvent(new CustomEvent('fount-autorun-script-update', {
			detail: {
				action: 'delete',
				script: { id: scriptId } // Only need ID for deletion
			}
		}))

		showToast(geti18n('browser_integration.autorun.delete_success'), 'success')
		loadAndRenderAutoRunScripts()
	} catch (error) {
		showToast(geti18n('browser_integration.error.delete_failed', { message: error.message }), 'error')
	}
}

async function loadAndRenderAutoRunScripts() {
	try {
		autorunScriptList.innerHTML = '<div class="text-center"><span class="loading loading-dots loading-md"></span></div>'
		const result = await api.getAutoRunScripts()
		if (!result.success) throw new Error(result.message)

		autorunScriptList.innerHTML = ''
		if (result.scripts.length === 0) 
			autorunScriptList.appendChild(await renderTemplate('autorun_empty_state'))
		 else {
			autoRunScriptsCache.clear()
			result.scripts.forEach(script => autoRunScriptsCache.set(script.id, script))
			autorunScriptList.appendChild(await renderTemplate('autorun_script_table', {
				scripts: result.scripts
			}))
		}

	} catch (error) {
		console.error('Failed to load auto-run scripts:', error)
		autorunScriptList.innerHTML = `<p class="text-error">${geti18n('browser_integration.error.load_failed', { message: error.message })}</p>`
	}
}

async function handleAddScript(e) {
	e.preventDefault()

	const scriptData = {
		comment: autorunComment.value,
		urlRegex: autorunUrlRegex.value,
		script: autorunScript.value,
	}

	// This object is for the userscript (includes the script content)
	const fullScriptPayload = {
		...scriptData,
	}

	try {
		// 1. Save metadata to the server
		const result = await api.addAutoRunScript(scriptData)
		if (!result.success) throw new Error(result.message)

		// The backend returns the metadata including the new ID
		const newId = result.script.id
		fullScriptPayload.id = newId

		// 2. Dispatch event to userscript
		window.dispatchEvent(new CustomEvent('fount-autorun-script-update', {
			detail: {
				action: 'add',
				script: fullScriptPayload
			}
		}))

		showToast(geti18n('browser_integration.autorun.add_success'), 'success')
		autorunScriptForm.reset()
		loadAndRenderAutoRunScripts() // This will re-render the list from the server's metadata
	} catch (error) {
		showToast(geti18n('browser_integration.error.add_failed', { message: error.message }), 'error')
	}
}

autorunScriptForm.addEventListener('submit', handleAddScript)

autorunScriptList.addEventListener('click', e => {
	const viewBtn = e.target.closest('.view-script-btn')
	if (viewBtn) {
		e.preventDefault()
		showViewScriptModal(viewBtn.dataset.scriptId)
		return
	}

	const deleteBtn = e.target.closest('.delete-script-btn')
	if (deleteBtn) {
		e.preventDefault()
		handleDeleteScript(deleteBtn.dataset.scriptId)
	}
})


async function main() {
	applyTheme()
	usingTemplates('/shells/browserIntegration/templates')
	await initTranslations('browser_integration')

	scriptUrlInput.value = `${window.location.origin}/shells/browserIntegration/script.user.js`

	copyScriptUrlButton.addEventListener('click', () => {
		navigator.clipboard.writeText(scriptUrlInput.value)
			.then(() => showToast(geti18n('browser_integration.copied_message'), 'success'))
			.catch(e => showToast(e.message, 'error'))
	})

	fetchAndRenderPages()
	setInterval(fetchAndRenderPages, 5000)

	await loadAndRenderAutoRunScripts()
}

main()
