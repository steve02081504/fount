/**
 * 【文件】public/profile/federationSettingsPanel.mjs
 * 【职责】资料页内节点级联邦设置 UI：中继与省电模式。
 * 【原理】getFederationSettings 初始化模板；保存时 putFederationSettings 写回服务端节点配置。
 * 【关联】src/api/federationSettings.mjs；hub/core/domUtils.mjs。
 */
import { mountTemplate } from '../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../scripts/features/toast.mjs'
import { getFederationSettings, putFederationSettings } from '../src/api/federationSettings.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

/**
 * 在个人资料页挂载节点级联邦设置面板。
 * @returns {Promise<void>}
 */
export async function initProfileFederationSettings() {
	const container = document.getElementById('profile-federation-settings')
	if (!container) return

	let data = {}
	try {
		data = await getFederationSettings()
	}
	catch (error) {
		showToastI18n('error', 'profile.federationSaveFailed', { error: error?.message || String(error) })
		return
	}

	const relayText = escapeHtml((data.relayUrls || []).join('\n'))
	await mountTemplate(container, 'profile/federation_panel', {
		relayText,
		batteryChecked: data.batterySaver ? 'checked' : '',
	})

	document.getElementById('profile-federation-save')?.addEventListener('click', async () => {
		const batterySaver = !!document.getElementById('profile-federation-battery-saver')?.checked
		const relayUrls = (document.getElementById('profile-federation-relay-urls')?.value || '')
			.split(/\r?\n/)
			.map(s => s.trim())
			.filter(s => s.startsWith('wss://'))
		try {
			await putFederationSettings({ batterySaver, relayUrls })
			showToastI18n('success', 'profile.federationSaved')
			await initProfileFederationSettings()
		}
		catch (e) {
			showToastI18n('error', 'profile.federationSaveFailed', { error: e?.message || String(e) })
		}
	})

	document.getElementById('profile-federation-reset')?.addEventListener('click', async () => {
		try {
			await putFederationSettings({
				batterySaver: false,
				relayUrls: [],
			})
			showToastI18n('success', 'profile.federationResetOk')
			await initProfileFederationSettings()
		}
		catch (e) {
			showToastI18n('error', 'profile.federationSaveFailed', { error: e?.message || String(e) })
		}
	})
}
