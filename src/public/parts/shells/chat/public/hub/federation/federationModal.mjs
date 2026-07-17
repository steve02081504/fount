/**
 * 【文件】public/hub/federation/federationModal.mjs
 * 【职责】Hub 联邦设置浮层：节点 relay/省电、群 房间口令轮换、入群快照修复、信誉与 DM 链接。
 * 【原理】`openFederationSettingsModal` 渲染 `hub/federation/modal` 模板并绑定 `#hub-settings-modal` 控件。
 * 【关联】wiring/index.mjs、core/overlayModal.mjs、src/api/group*.mjs、src/dmLink.mjs。
 */
import { isHex64, normalizeHex64, HEX_ID_64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { renderTemplate } from '../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { confirmI18n, geti18n } from '../../../../../scripts/i18n/index.mjs'
import { getFederationSettings, putFederationSettings } from '../../src/api/federationSettings.mjs'
import { getGroupState } from '../../src/api/groupCore.mjs'
import { repairJoinSnapshot, rotateFederationRoomSecret } from '../../src/api/groupFederation.mjs'
import { getGroupReputation, postReputationReset, postReputationSlash } from '../../src/api/groupGovernance.mjs'
import { createDmLinkAndSync, rotateDmLinkAndSync } from '../../src/dmLink.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { closeOverlayModal, openOverlayModal } from '../core/overlayModal.mjs'

/**
 * @param {string} hex 64 hex 字符
 * @returns {Uint8Array} 32 字节
 */
function hexSeedToBytes(hex) {
	const normalized = normalizeHex64(hex)
	if (!HEX_ID_64.test(normalized))
		throw new Error('invalid hex seed')
	return new Uint8Array(normalized.match(/.{2}/g).map(byte => Number.parseInt(byte, 16)))
}

/**
 * 绑定关闭按钮。
 * @returns {void}
 */
function wireCloseButtons() {
	for (const button of document.querySelectorAll('#federation-close'))
		button.addEventListener('click', closeOverlayModal)
}

/**
 * 格式化信誉 dump 文本。
 * @param {object} reputation 信誉对象
 * @returns {string | null} 文本或 null（空表）
 */
function formatReputationDump(reputation) {
	const byNodeHash = reputation?.byNodeHash || {}
	const lines = Object.entries(byNodeHash)
		.sort((left, right) => Number(right[1]?.score ?? 0) - Number(left[1]?.score ?? 0))
		.map(([nodeId, row]) => `${nodeId}: ${Number(row?.score ?? 0).toFixed(3)}`)
	return lines.length ? lines.join('\n') : null
}

/**
 * 刷新模态内信誉 dump。
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
async function refreshReputationDump(groupId) {
	const dump = document.getElementById('federation-rep-dump')
	if (!dump) return
	try {
		const { reputation } = await getGroupReputation()
		const text = formatReputationDump(reputation)
		if (text) {
			delete dump.dataset.i18n
			dump.textContent = text
		}
		else {
			dump.textContent = ''
			dump.dataset.i18n = 'chat.hub.fedRepEmpty'
		}
	}
	catch (error) {
		dump.textContent = String(error.message || error)
		delete dump.dataset.i18n
	}
}

/**
 * 隐藏群级区块（无当前群时）。
 * @returns {void}
 */
function hideGroupOnlySections() {
	for (const id of ['federation-rep-section', 'federation-slash-section'])
		document.getElementById(id)?.classList.add('hidden')
}

/**
 * 绑定联邦模态交互。
 * @param {string | null | undefined} groupId 当前群 ID
 * @returns {void}
 */
function wireFederationModalEvents(groupId) {
	wireCloseButtons()

	document.getElementById('federation-save')?.addEventListener('click', async () => {
		const batterySaver = !!document.getElementById('federation-battery-saver')?.checked
		const relayUrls = (document.getElementById('federation-relay-urls')?.value || '')
			.split(/\r?\n/u)
			.map(line => line.trim())
			.filter(line => line.startsWith('wss://'))
		try {
			await putFederationSettings({ batterySaver, relayUrls })
			showToastI18n('success', 'chat.hub.fedSaved')
		}
		catch (error) {
			showToastI18n('error', 'profile.federationSaveFailed', { error: error.message })
		}
	})

	document.getElementById('federation-rotate-room-secret')?.addEventListener('click', async () => {
		if (!groupId) return
		if (!confirmI18n('chat.hub.fedRotateRoomSecretConfirm')) return
		try {
			await rotateFederationRoomSecret(groupId)
			showToastI18n('success', 'chat.hub.fedRotateRoomSecretOk')
		}
		catch (error) {
			showToastI18n('error', 'profile.federationSaveFailed', { error: error.message })
		}
	})

	document.getElementById('federation-repair-join-snapshot')?.addEventListener('click', async () => {
		if (!groupId) return
		try {
			const result = await repairJoinSnapshot(groupId)
			if (result.skipped)
				showToastI18n('success', 'chat.hub.fedRepairJoinSnapshotOk', { channels: 0 })
			else
				showToastI18n('success', 'chat.hub.fedRepairJoinSnapshotOk', { channels: result.channels ?? 0 })
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.fedRepairJoinSnapshotFailed', { error: error.message })
		}
	})

	document.getElementById('federation-slash-submit')?.addEventListener('click', async () => {
		if (!groupId) return
		const targetPubKeyHash = String(document.getElementById('federation-slash-target')?.value || '').trim().toLowerCase()
		if (!isHex64(targetPubKeyHash)) {
			showToastI18n('error', 'chat.hub.fedSlashNeedHash')
			return
		}
		const claim = Number(document.getElementById('federation-slash-claim')?.value ?? 0.25)
		const verified = !!document.getElementById('federation-slash-verified')?.checked
		const proofEventId = String(document.getElementById('federation-slash-proof')?.value || '').trim().toLowerCase()
		try {
			await postReputationSlash(groupId, {
				targetPubKeyHash,
				claim,
				verified,
				proof: verified && proofEventId ? { eventId: proofEventId } : undefined,
			})
			showToastI18n('success', 'chat.hub.fedSlashOk')
			await refreshReputationDump(groupId)
		}
		catch (error) {
			showToastI18n('error', 'profile.federationSaveFailed', { error: error.message })
		}
	})

	document.getElementById('federation-reset-submit')?.addEventListener('click', async () => {
		if (!groupId) return
		const targetPubKeyHash = String(document.getElementById('federation-slash-target')?.value || '').trim().toLowerCase()
		if (!isHex64(targetPubKeyHash)) {
			showToastI18n('error', 'chat.hub.fedSlashNeedHash')
			return
		}
		try {
			await postReputationReset(groupId, targetPubKeyHash)
			showToastI18n('success', 'chat.hub.fedResetOk')
			await refreshReputationDump(groupId)
		}
		catch (error) {
			showToastI18n('error', 'profile.federationSaveFailed', { error: error.message })
		}
	})

	document.getElementById('federation-dm-rotate')?.addEventListener('click', async () => {
		if (!confirmI18n('chat.hub.fedDmRotateConfirm')) return
		try {
			const nonce = await rotateDmLinkAndSync()
			showToastI18n('success', 'chat.hub.fedNonceRotated', { nonce: nonce.slice(0, 12) })
		}
		catch (error) {
			showToastI18n('error', 'profile.federationSaveFailed', { error: error.message })
		}
	})

	document.getElementById('federation-dm-issue')?.addEventListener('click', async () => {
		const pubKeyHex = normalizeHex64(document.getElementById('federation-dm-pubkey')?.value || '')
		const secretHex = normalizeHex64(document.getElementById('federation-dm-secret')?.value || '')
		const nodeUrl = String(document.getElementById('federation-dm-node')?.value || '').trim()
		if (!HEX_ID_64.test(pubKeyHex)) {
			showToastI18n('error', 'chat.hub.fedDmNeedPubKey')
			return
		}
		if (!HEX_ID_64.test(secretHex)) {
			showToastI18n('error', 'chat.hub.fedDmNeedSecretKey')
			return
		}
		try {
			const url = await createDmLinkAndSync({
				pubKeyHex,
				secretKey32: hexSeedToBytes(secretHex),
				nodeUrl: nodeUrl || undefined,
			})
			const urlField = document.getElementById('federation-dm-url')
			if (urlField instanceof HTMLTextAreaElement)
				urlField.value = url
			try {
				await navigator.clipboard.writeText(url)
			}
			catch { /* clipboard optional */ }
			showToastI18n('success', 'chat.hub.fedDmIssued')
		}
		catch (error) {
			showToastI18n('error', 'profile.federationSaveFailed', { error: error.message })
		}
	})
}

/**
 * 打开 Hub 联邦设置浮层。
 * @param {() => string | null | undefined} getGroupId 当前群 ID 提供者
 * @returns {Promise<void>}
 */
export async function openFederationSettingsModal(getGroupId) {
	const groupId = typeof getGroupId === 'function' ? getGroupId() : getGroupId
	const tooltipText = Object.fromEntries([
		'fedRelayUrlsTip',
		'fedBatterySaverTip',
		'fedGroupRecoveryTip',
		'fedRepTip',
		'fedSlashTip',
		'fedDmLinkTip',
	].map(key => [key, escapeHtml(geti18n(`chat.hub.${key}`))]))

	/** @type {object} */
	let fedSettings = {}
	try {
		fedSettings = await getFederationSettings()
	}
	catch (error) {
		const root = await renderTemplate('hub/federation/modal', {
			mode: 'error',
			errorMessage: error.message,
		})
		openOverlayModal({
			titleKey: 'chat.hub.federationTitle',
			subtitleKey: 'chat.hub.federationSubtitle',
			body: root.querySelector('[data-federation-part="body"]'),
			footer: root.querySelector('[data-federation-part="footer"]'),
		})
		wireCloseButtons()
		return
	}

	let showRotateRoomSecret = false
	if (groupId) 
		try {
			const state = await getGroupState(groupId)
			showRotateRoomSecret = !!state?.groupSettings?.roomSecret?.trim()
		}
		catch { /* group sections stay hidden below */ }
	

	const relayText = escapeHtml((fedSettings.relayUrls || []).join('\n'))
	const root = await renderTemplate('hub/federation/modal', {
		mode: 'ok',
		relayText,
		batteryChecked: fedSettings.batterySaver ? 'checked' : '',
		showRotateRoomSecret,
		...tooltipText,
	})

	openOverlayModal({
		titleKey: 'chat.hub.federationTitle',
		subtitleKey: 'chat.hub.federationSubtitle',
		body: root.querySelector('[data-federation-part="body"]'),
		footer: root.querySelector('[data-federation-part="footer"]'),
	})

	wireFederationModalEvents(groupId || null)

	if (groupId)
		await refreshReputationDump(groupId)
	else
		hideGroupOnlySections()
}
