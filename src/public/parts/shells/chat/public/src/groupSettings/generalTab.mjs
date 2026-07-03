import { openDialogFromTemplate } from '../../../../../../scripts/features/dialog.mjs'
import { usingTemplates } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { postFederationTuning, rotateGroupKey, submitOwnerSuccession } from '../api/groupApi.mjs'

import { collectFederationTuningPatch } from './federationTab.mjs'
import { collectIceServersFromDom, wireIceServersEditor } from './iceTab.mjs'
import { wireInvitePanel } from './inviteTab.mjs'
import { readApiError } from './shared.mjs'

/** @param {import('./state.mjs').GroupSettingsContext} ctx @returns {Promise<void>} */
export async function showOwnerSuccessionModal(ctx) {
	if (!ctx.groupId) return
	usingTemplates('/parts/shells:chat/src/templates')
	const viewerPubKeyHash = String(ctx.stateJson?.viewerMemberPubKeyHash || '').trim().toLowerCase()
	await openDialogFromTemplate('group/modals/owner_succession', {
		viewerPubKeyHash: escapeHtml(viewerPubKeyHash),
	}, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: dialog => {
			const input = dialog.querySelector('[data-owner-pubkey-input]')
			const submitButton = dialog.querySelector('[data-owner-succ-submit]')
			/** @returns {void} */
			const closeModal = () => dialog.close()
			dialog.querySelector('[data-owner-succ-self]')?.addEventListener('click', () => {
				if (input instanceof HTMLInputElement && viewerPubKeyHash)
					input.value = viewerPubKeyHash
			})
			dialog.querySelector('[data-owner-succ-cancel]')?.addEventListener('click', closeModal)
			dialog.querySelector('[data-owner-succ-submit]')?.addEventListener('click', async () => {
				const proposedOwnerPubKeyHash = input instanceof HTMLInputElement ? input.value.trim().toLowerCase() : ''
				if (!proposedOwnerPubKeyHash) {
					showToastI18n('warning', 'chat.group.ownerSuccessionNeedHash')
					return
				}
				if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true
				try {
					await submitOwnerSuccession(ctx.groupId, {
						proposedOwnerPubKeyHash,
						ballotId: crypto.randomUUID(),
					})
					showToastI18n('success', 'chat.group.settingsPage.ownerSuccessionOk')
					closeModal()
					await ctx.reload(ctx.groupId)
				}
				catch (error) {
					showToastI18n('error', 'chat.group.settingsPage.ownerSuccessionFailed', { error: error.message })
				}
				finally {
					if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false
				}
			})
		},
	})
}

/** @param {import('./state.mjs').GroupSettingsContext} ctx @returns {Promise<void>} */
export async function saveGroupSettings(ctx) {
	if (!ctx.settingsCaps?.canEditGroupSettings) {
		showToastI18n('error', 'chat.group.settingsPage.governanceDenied')
		return
	}
	const metaResponse = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(ctx.groupId)}/meta`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({
			name: document.getElementById('group-name').value.trim(),
			description: document.getElementById('group-description').value.trim(),
		})
	})
	if (!metaResponse.ok) throw new Error(await readApiError(metaResponse))

	const gossipTtl = Number.parseInt(document.getElementById('gossip-ttl').value, 10)
	const settingsResponse = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(ctx.groupId)}/settings`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({
			joinPolicy: document.getElementById('join-policy').value,
			powDifficulty: Number.parseInt(document.getElementById('pow-difficulty').value, 10) || 4,
			streamGeneratingIdleMs: Number.parseInt(document.getElementById('stream-generating-idle-ms').value, 10) || 150000,
			autoReplyFrequency: Math.max(0, Number.parseInt(document.getElementById('auto-reply-frequency')?.value, 10) || 0),
			maxDagPayloadBytes: Number.parseInt(document.getElementById('max-dag-payload-bytes').value, 10) || 262144,
			batterySaver: !!document.getElementById('battery-saver')?.checked,
			trustedPeerSlots: Number.parseInt(document.getElementById('trusted-peer-slots')?.value, 10) || 8,
			explorePeerSlots: Number.parseInt(document.getElementById('explore-peer-slots')?.value, 10) || 4,
			maxPeers: Number.parseInt(document.getElementById('max-peers')?.value, 10) || 24,
			gossipTtl: Number.isFinite(gossipTtl) ? gossipTtl : 2,
			wantIdsBudget: Number.parseInt(document.getElementById('want-ids-budget')?.value, 10) || 16,
			hlcMaxSkewMs: Number.parseInt(document.getElementById('hlc-max-skew-ms')?.value, 10) || 3_600_000,
			streamingSfuWss: document.getElementById('streaming-sfu-wss')?.value?.trim() || null,
			messageContentRetentionMs: Number.parseInt(
				document.getElementById('message-content-retention-ms')?.value,
				10,
			) || 0,
			eventRetentionDepth: Number.parseInt(document.getElementById('event-retention-depth')?.value, 10) || 200_000,
			eventRetentionMs: Number.parseInt(document.getElementById('event-retention-ms')?.value, 10) || 0,
			compactTriggerEventDepth: Number.parseInt(document.getElementById('compact-trigger-event-depth')?.value, 10) || 100_000,
			messageRateLimitPerMin: Math.max(1, Math.min(120,
				Number.parseInt(document.getElementById('message-rate-limit-per-min')?.value, 10) || 10)),
			autoReplyTokenBucketEnabled: !!document.getElementById('auto-reply-token-bucket-enabled')?.checked,
			autoReplyTokenBurst: Math.max(1, Math.min(12,
				Number.parseInt(document.getElementById('auto-reply-token-burst')?.value, 10) || 2)),
			autoReplyTokenRefillPerMessage: Math.max(0.1, Math.min(5,
				Number.parseFloat(document.getElementById('auto-reply-token-refill')?.value) || 0.5)),
			fileCeMode: String(document.getElementById('file-ce-mode')?.value || 'convergent') === 'random'
				? 'random'
				: 'convergent',
			iceServers: collectIceServersFromDom(),
			discoveryPublic: !!document.getElementById('discovery-public')?.checked,
			discoveryTitle: document.getElementById('discovery-title')?.value?.trim() || null,
			discoveryBlurb: document.getElementById('discovery-blurb')?.value?.trim() || null,
			autoChannelGc: !!document.getElementById('auto-channel-gc')?.checked,
			hotLatestMessageCount: Math.max(0, Number.parseInt(
				document.getElementById('hot-latest-message-count')?.value,
				10,
			) || 50),
			pinContextMessageCount: Math.max(0, Number.parseInt(
				document.getElementById('pin-context-message-count')?.value,
				10,
			) || 30),
		})
	})
	if (!settingsResponse.ok) throw new Error(await readApiError(settingsResponse))

	const partitionEl = document.getElementById('federation-partition-count')
	if (partitionEl) {
		const tuningPatch = collectFederationTuningPatch()
		if (Object.keys(tuningPatch).length)
			await postFederationTuning(ctx.groupId, tuningPatch)
	}

	showToastI18n('success', 'chat.group.settingsPage.saveSuccess')
	await ctx.reload(ctx.groupId)
}

/** @param {import('./state.mjs').GroupSettingsContext} ctx @returns {Promise<void>} */
export async function deleteGroup(ctx) {
	if (!ctx.settingsCaps?.canDeleteGroup) {
		showToastI18n('error', 'chat.group.settingsPage.governanceDenied')
		return
	}
	if (!confirmI18n('chat.group.settingsPage.deleteConfirm')) return
	const resp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(ctx.groupId)}`, {
		method: 'DELETE',
		credentials: 'include'
	})
	const data = await resp.json()
	if (!resp.ok) throw new Error(data.error)
	showToastI18n('success', 'chat.group.settingsPage.deleteSuccess')
	window.location.href = '/parts/shells:chat/hub/'
}

/** @param {import('./state.mjs').GroupSettingsContext} ctx @returns {Promise<void>} */
export async function renderGroupSettings(ctx) {
	const { appendTemplate } = await import('../../../../../../scripts/features/template.mjs')
	const container = document.getElementById('group-settings-container')
	if (!container || !ctx.settingsCaps) return

	container.replaceChildren()

	if (!ctx.settingsCaps.isMember) {
		await appendTemplate(container, 'group/settings/settings_panel_denied', {
			messageKey: 'chat.group.settingsPage.notMember',
		})
		return
	}

	await appendTemplate(container, 'group/settings/basic_panel_overview', {
		currentState: ctx.state,
	})

	if (ctx.settingsCaps.showGovernancePanel) {
		await appendTemplate(container, 'group/settings/basic_panel', {
			currentState: ctx.state,
			showFullSettings: ctx.settingsCaps.canEditGroupSettings,
			showDeleteGroup: ctx.settingsCaps.canDeleteGroup,
			showKeyRotate: ctx.settingsCaps.canKeyRotate,
			showFedTuning: ctx.settingsCaps.canFedTuning,
			showOwnerSuccession: ctx.settingsCaps.canOwnerSuccession,
		})
		await wireIceServersEditor(ctx)
		document.getElementById('save-group-settings')?.addEventListener('click', () => {
			void saveGroupSettings(ctx)
		})
		document.getElementById('group-settings-delete-group-button')?.addEventListener('click', () => {
			void deleteGroup(ctx)
		})
	}

	if (ctx.settingsCaps.canInviteMembers) {
		await appendTemplate(container, 'group/settings/invite_panel', {})
		wireInvitePanel(ctx)
	}

	document.getElementById('group-settings-key-rotate-button')?.addEventListener('click', async () => {
		if (!ctx.groupId || !confirmI18n('chat.group.settingsPage.keyRotateConfirm')) return
		try {
			const result = await rotateGroupKey(ctx.groupId)
			showToastI18n('success', 'chat.group.settingsPage.keyRotateOk')
			const generation = Number(result?.generation)
			const maxGenerations = Number(result?.maxGenerations) || 64
			if (Number.isFinite(generation) && generation >= maxGenerations - 4)
				showToastI18n('warning', 'chat.group.settingsPage.gshGenerationNearLimit', {
					generation: String(generation),
					maxGenerations: String(maxGenerations),
				})
			await ctx.reload(ctx.groupId)
		}
		catch (error) {
			showToastI18n('error', 'chat.group.settingsPage.keyRotateFailed', { error: error.message })
		}
	})
	document.getElementById('group-settings-owner-succession-button')?.addEventListener('click', () => {
		void showOwnerSuccessionModal(ctx)
	})
}
