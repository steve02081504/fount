import { applyTheme } from '/scripts/theme.mjs'
import { initTranslations, setLocalizeLogic } from '/scripts/i18n.mjs'

/**
 * 转义 HTML 字符串。
 * @param {string} str - 要转义的字符串。
 * @returns {string} - 转义后的 HTML 字符串。
 */
function escapeHtml(str) {
	const div = document.createElement('div')
	div.textContent = str
	return div.innerHTML
}

applyTheme()
const headingEl = document.getElementById('directory-listing-heading')
headingEl.dataset.path = escapeHtml(headingEl.dataset.path)
await initTranslations('directoryListing')

const data = JSON.parse(document.getElementById('directory-data').textContent)

setLocalizeLogic(document.head, () => {
	document.title = headingEl.textContent
})

const tbody = document.getElementById('directory-listing-tbody')
if (data.parentUrl) {
	const tr = document.createElement('tr')
	tr.innerHTML = `<td colspan="3"><a href="${escapeHtml(data.parentUrl)}" class="link link-hover flex items-center gap-2 text-base-content/70" data-i18n="directoryListing.parentLink"></a></td>`
	tbody.appendChild(tr)
}
for (const entry of data.entries) {
	const tr = document.createElement('tr')
	tr.classList.add('hover')
	const nameCell = entry.name
	const href = escapeHtml(entry.href)
	const mime = escapeHtml(entry.mimeType ?? '—')
	const size = escapeHtml(entry.sizeFormatted ?? '—')
	tr.innerHTML = `<td><a href="${href}" class="link link-hover font-medium">${escapeHtml(nameCell)}</a></td><td class="text-base-content/60 text-sm">${mime}</td><td class="text-base-content/60 text-sm">${size}</td>`
	tbody.appendChild(tr)
}
