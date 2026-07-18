/**
 * 【文件】public/profile/ownerSettingsPanel.mjs
 * 【职责】资料页「我的主人」设置：为当前 operator 实体声明 / 清除 ownerEntityHash。
 * 【原理】读 viewer + profile；PUT /entities/owner；本地 agent 列表作快捷选择；保存前高风险确认。
 */
import { mountTemplate } from '../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../scripts/features/toast.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { showOwnerConfirmDialog } from './ownerConfirmDialog.mjs'

/**
 * @param {string} raw 输入
 * @returns {string | null} 规范化 128-hex 或 null（空）
 */
function normalizeOwnerInput(raw) {
	const value = String(raw || '').trim().toLowerCase()
	if (!value) return null
	if (!/^[0-9a-f]{128}$/u.test(value)) throw new Error('invalid ownerEntityHash')
	return value
}

/**
 * @param {string | null} ownerEntityHash 主人 hash；null 清除
 * @returns {Promise<void>}
 */
async function putOwner(ownerEntityHash) {
	const res = await fetch('/api/parts/shells:chat/entities/owner', {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ownerEntityHash }),
	})
	if (!res.ok) {
		const data = await res.json().catch(() => ({}))
		throw new Error(data.error || res.statusText)
	}
}

/**
 * 在个人资料页挂载「我的主人」面板。
 * @returns {Promise<void>}
 */
export async function initProfileOwnerSettings() {
	const container = document.getElementById('profile-owner-settings')
	if (!container) return

	let viewerEntityHash = null
	/** @type {{ entityHash: string, charPartName: string }[]} */
	let agents = []
	let ownerEntityHash = ''
	try {
		const viewerRes = await fetch('/api/parts/shells:chat/viewer', { credentials: 'include' })
		if (!viewerRes.ok) throw new Error(`viewer ${viewerRes.status}`)
		const viewer = await viewerRes.json()
		viewerEntityHash = viewer.viewerEntityHash || null
		agents = Array.isArray(viewer.agents) ? viewer.agents : []
		ownerEntityHash = String(viewer.profile?.ownerEntityHash || '').trim().toLowerCase()
		if (viewerEntityHash && !ownerEntityHash) {
			const profileRes = await fetch(`/api/parts/shells:chat/entities/${encodeURIComponent(viewerEntityHash)}`, {
				credentials: 'include',
			})
			if (profileRes.ok) {
				const data = await profileRes.json()
				ownerEntityHash = String(data.profile?.ownerEntityHash || '').trim().toLowerCase()
			}
		}
	}
	catch (error) {
		showToastI18n('error', 'profile.ownerSaveFailed', { error: error?.message || String(error) })
		return
	}

	const agentButtons = agents.map(row => {
		const hash = String(row.entityHash || '').trim().toLowerCase()
		const name = escapeHtml(String(row.charPartName || hash.slice(0, 8)))
		return `<button type="button" class="btn btn-ghost btn-xs" data-owner-pick="${escapeHtml(hash)}">${name}</button>`
	}).join('')

	await mountTemplate(container, 'profile/owner_panel', {
		ownerEntityHash: escapeHtml(ownerEntityHash),
		agentButtons,
		agentShortcutsHidden: agents.length ? '' : 'hidden',
	})

	container.querySelectorAll('[data-owner-pick]').forEach(btn => {
		btn.addEventListener('click', () => {
			const input = document.getElementById('profile-owner-entity-hash')
			if (input) input.value = btn.getAttribute('data-owner-pick') || ''
		})
	})

	document.getElementById('profile-owner-save')?.addEventListener('click', async () => {
		try {
			const next = normalizeOwnerInput(document.getElementById('profile-owner-entity-hash')?.value)
			if (!next) {
				showToastI18n('error', 'profile.ownerSaveFailed', { error: 'empty' })
				return
			}
			if (next === ownerEntityHash) {
				showToastI18n('success', 'profile.ownerSaved')
				return
			}
			const confirmed = await showOwnerConfirmDialog(next)
			if (!confirmed) return
			await putOwner(next)
			showToastI18n('success', 'profile.ownerSaved')
			await initProfileOwnerSettings()
		}
		catch (e) {
			showToastI18n('error', 'profile.ownerSaveFailed', { error: e?.message || String(e) })
		}
	})

	document.getElementById('profile-owner-clear')?.addEventListener('click', async () => {
		try {
			await putOwner(null)
			showToastI18n('success', 'profile.ownerCleared')
			await initProfileOwnerSettings()
		}
		catch (e) {
			showToastI18n('error', 'profile.ownerSaveFailed', { error: e?.message || String(e) })
		}
	})
}
