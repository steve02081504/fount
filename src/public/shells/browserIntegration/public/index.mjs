import { initTranslations, i18nElement, geti18n } from '../../../scripts/i18n.mjs'
import { renderTemplate, usingTemplates } from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast } from '../../../scripts/toast.mjs'

async function renderPages(pages) {
	const pagesListDiv = document.getElementById('connected-pages-list')
	if (!pagesListDiv) return

	try {
		pagesListDiv.innerHTML = '' // Clear current list

		if (pages.length === 0) {
			const emptyState = await renderTemplate('empty_state')
			pagesListDiv.appendChild(emptyState)
			i18nElement(pagesListDiv)
			return
		}

		const table = document.createElement('table')
		table.className = 'table'
		table.innerHTML = `
<thead>
	<tr>
		<th data-i18n="browser_integration.page_title"></th>
		<th data-i18n="browser_integration.page_url"></th>
		<th data-i18n="browser_integration.page_status"></th>
	</tr>
</thead>
<tbody>
</tbody>
`

		const tbody = table.querySelector('tbody')
		for (const page of pages) {
			const row = await renderTemplate('page_row', page)
			tbody.appendChild(row)
		}

		pagesListDiv.appendChild(table)
		i18nElement(pagesListDiv)

	} catch (error) {
		console.error('Failed to render pages:', error)
		pagesListDiv.innerHTML = '<p class="text-error" data-i18n="browser_integration.fetch_pages_error"></p>'
		i18nElement(pagesListDiv)
	}
}

async function fetchAndRenderPages() {
	try {
		const response = await fetch('/api/shells/browserIntegration/pages')
		if (!response.ok)
			throw new Error(`Failed to fetch pages: ${response.statusText}`)

		const pages = await response.json()
		await renderPages(pages)
	} catch (error) {
		console.error('Failed to fetch and render pages:', error)
		// Optionally, display an error in the UI
		const pagesListDiv = document.getElementById('connected-pages-list')
		if (pagesListDiv) {
			pagesListDiv.innerHTML = '<p class="text-error" data-i18n="browser_integration.fetch_pages_error"></p>'
			i18nElement(pagesListDiv)
		}
	}
}


async function main() {
	applyTheme()
	usingTemplates('/shells/browserIntegration/templates')
	await initTranslations('browser_integration')
	i18nElement(document.body)

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
