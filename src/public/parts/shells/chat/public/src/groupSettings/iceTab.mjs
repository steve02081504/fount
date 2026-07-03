import { renderTemplate } from '../../../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

/**
 * @param {import('./state.mjs').GroupSettingsContext} ctx 群设置上下文
 * @param {object} [entry] ICE 行
 * @returns {Promise<HTMLElement>} 可编辑的 ICE 配置行
 */
async function buildIceServerRow(entry = {}) {
	const urls = Array.isArray(entry.urls) ? entry.urls.join(', ') : String(entry.urls || '')
	const row = await renderTemplate('group/settings/ice_server_row', {
		urls: escapeHtml(urls),
		username: escapeHtml(String(entry.username || '')),
		credential: escapeHtml(String(entry.credential || '')),
	})
	row.querySelector('[data-ice-remove]')?.addEventListener('click', () => row.remove())
	return row
}

/** @param {import('./state.mjs').GroupSettingsContext} ctx @returns {Promise<void>} */
export async function wireIceServersEditor(ctx) {
	const host = document.getElementById('ice-servers-host')
	if (!host) return
	const list = Array.isArray(ctx.state?.groupSettings?.iceServers)
		? ctx.state.groupSettings.iceServers
		: [{ urls: 'stun:stun.l.google.com:19302' }]
	host.replaceChildren(...await Promise.all(list.map(entry => buildIceServerRow(entry))))
	document.getElementById('ice-servers-add')?.addEventListener('click', async () => {
		if (host.querySelectorAll('[data-ice-row]').length >= 8) return
		host.appendChild(await buildIceServerRow({ urls: 'stun:' }))
	})
}

/** @returns {object[]} 待写入 groupSettings 的 iceServers */
export function collectIceServersFromDom() {
	const host = document.getElementById('ice-servers-host')
	if (!host) return []
	const out = []
	for (const row of host.querySelectorAll('[data-ice-row]')) {
		const urlsRaw = row.querySelector('[data-ice-url]')?.value?.trim()
		if (!urlsRaw) continue
		const urls = urlsRaw.includes(',')
			? urlsRaw.split(',').map(s => s.trim()).filter(Boolean)
			: urlsRaw
		const username = row.querySelector('[data-ice-user]')?.value?.trim()
		const credential = row.querySelector('[data-ice-cred]')?.value
		const entry = { urls }
		if (username) {
			entry.username = username
			entry.credential = credential || ''
		}
		out.push(entry)
		if (out.length >= 8) break
	}
	return out
}
