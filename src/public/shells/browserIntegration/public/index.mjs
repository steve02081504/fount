import { initTranslations, i18nElement, geti18n } from '../../../scripts/i18n.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast } from '../../../scripts/toast.mjs'

let lastPages = ''
const pagesListDiv = document.getElementById('connected-pages-list')

async function renderPages(pages) {
	pagesListDiv.innerHTML = ''
	if (pages.length === 0) pagesListDiv.appendChild(await renderTemplate('empty_state'))
	else pagesListDiv.appendChild(await renderTemplate('page_table', { pages }))
}

async function fetchAndRenderPages() {
	try {
		const response = await fetch('/api/shells/browserIntegration/pages')
		if (!response.ok) throw new Error(`Failed to fetch pages: ${response.statusText}`)

		const newPages = await response.text()
		if (lastPages === newPages) return

		await renderPages(JSON.parse(lastPages = newPages))
	} catch (error) {
		lastPages = ''
		console.error('Failed to fetch and render pages:', error)
		pagesListDiv.appendChild(await renderTemplate('error_message'))
	}
}


async function main() {
	applyTheme()
	usingTemplates('/shells/browserIntegration/templates')
	await initTranslations('browser_integration')

	const scriptUrlInput = document.getElementById('script-url-input')
	if (scriptUrlInput)
		scriptUrlInput.value = `${window.location.origin}/shells/browserIntegration/script.user.js`

	const copyButton = document.getElementById('copy-script-url-button')
	if (copyButton)
		copyButton.addEventListener('click', () => {
			navigator.clipboard.writeText(scriptUrlInput.value)
				.then(() => showToast(geti18n('browser_integration.copied_message'), 'success'))
				.catch(e => showToast(e.message, 'error'))
		})

	fetchAndRenderPages()
	setInterval(fetchAndRenderPages, 5000)
}

main()
