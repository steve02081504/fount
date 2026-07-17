import { formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { geti18n, initTranslations } from '/scripts/i18n/index.mjs'

import { chatApi, socialApi } from '../lib/apiClient.mjs'
import { runSocialWrite } from '../lib/socialWrite.mjs'
import { socialState } from '../state.mjs'

import { renderBlocklist } from './profile.mjs'

/**
 * @param {number} weight 权重
 * @returns {string} 格式化权重
 */
function formatWeight(weight) {
	const n = Number(weight)
	if (!Number.isFinite(n)) return '0'
	return n.toFixed(2).replace(/\.?0+$/, '')
}

/**
 * @param {HTMLElement} panel 面板
 * @param {object[]} entries 屏蔽词条目
 * @returns {void}
 */
function renderMutedKeywordsSection(panel, entries) {
	const section = document.createElement('section')
	section.className = 'settings-card card'
	section.innerHTML = `
		<h3 class="settings-card-title">${escapeHtml(geti18n('social.settings.mutedKeywordsTitle'))}</h3>
		<p class="settings-hint">${escapeHtml(geti18n('social.settings.mutedKeywordsHint'))}</p>
		<form id="mutedKeywordForm" class="muted-keyword-form">
			<input type="text" id="mutedKeywordInput" maxlength="64" placeholder="${escapeHtml(geti18n('social.settings.mutedKeywordsPlaceholder'))}" />
			<label class="muted-keyword-match-tags">
				<input type="checkbox" id="mutedKeywordMatchTags" checked />
				<span>${escapeHtml(geti18n('social.settings.mutedKeywordsMatchTags'))}</span>
			</label>
			<button type="submit" class="btn btn-primary btn-sm">${escapeHtml(geti18n('social.settings.mutedKeywordsAdd'))}</button>
		</form>
		<div class="muted-keyword-chips" id="mutedKeywordChips"></div>
	`
	panel.appendChild(section)

	const chips = section.querySelector('#mutedKeywordChips')
	/**
	 * @param {object[]} list 条目
	 */
	function paintChips(list) {
		chips.replaceChildren()
		if (!list.length) {
			chips.innerHTML = `<p class="empty-hint">${escapeHtml(geti18n('social.settings.mutedKeywordsEmpty'))}</p>`
			return
		}
		for (const entry of list) {
			const chip = document.createElement('button')
			chip.type = 'button'
			chip.className = 'muted-keyword-chip'
			chip.dataset.pattern = entry.pattern
			const tagHint = entry.matchTags === false ? '' : ' #Tag'
			chip.innerHTML = `<span>${escapeHtml(entry.pattern)}${escapeHtml(tagHint)}</span><span aria-hidden="true">×</span>`
			chip.title = geti18n('social.settings.mutedKeywordsRemove')
			chips.appendChild(chip)
		}
	}
	paintChips(entries)

	/**
	 * @param {object[]} next 下一份条目
	 * @returns {Promise<object[]>} 服务端条目
	 */
	async function persist(next) {
		const data = await runSocialWrite('mutedKeywords', () => socialApi('/profile/muted-keywords', {
			method: 'PUT',
			body: JSON.stringify({ entries: next }),
		}))
		const saved = data?.entries || next
		paintChips(saved)
		return saved
	}

	section.querySelector('#mutedKeywordForm')?.addEventListener('submit', event => {
		event.preventDefault()
		const input = section.querySelector('#mutedKeywordInput')
		const matchTags = section.querySelector('#mutedKeywordMatchTags')
		const pattern = input instanceof HTMLInputElement ? input.value.trim().toLowerCase() : ''
		if (!pattern) return
		const next = [
			...entries.filter(entry => entry.pattern !== pattern),
			{
				pattern,
				matchTags: matchTags instanceof HTMLInputElement ? matchTags.checked : true,
			},
		]
		void persist(next).then(saved => {
			entries.splice(0, entries.length, ...saved)
			if (input instanceof HTMLInputElement) input.value = ''
		})
	})

	chips.addEventListener('click', event => {
		const chip = event.target instanceof Element ? event.target.closest('.muted-keyword-chip') : null
		if (!(chip instanceof HTMLElement) || !chip.dataset.pattern) return
		const next = entries.filter(entry => entry.pattern !== chip.dataset.pattern)
		void persist(next).then(saved => {
			entries.splice(0, entries.length, ...saved)
		})
	})
}

/**
 * @param {HTMLElement} panel 面板
 * @returns {Promise<void>}
 */
async function renderTranslationPrefsSection(panel) {
	const data = await chatApi('/translation-prefs').catch(() => ({ prefs: { autoTranslate: false } }))
	const prefs = data?.prefs || { autoTranslate: false }
	const section = document.createElement('section')
	section.className = 'settings-card card'
	section.innerHTML = `
		<h3 class="settings-card-title">${escapeHtml(geti18n('social.settings.autoTranslateTitle'))}</h3>
		<p class="settings-hint">${escapeHtml(geti18n('social.settings.autoTranslateHint'))}</p>
		<label class="settings-toggle">
			<input type="checkbox" id="socialAutoTranslate" ${prefs.autoTranslate ? 'checked' : ''} />
			<span>${escapeHtml(geti18n('social.settings.autoTranslateEnable'))}</span>
		</label>
	`
	panel.appendChild(section)
	section.querySelector('#socialAutoTranslate')?.addEventListener('change', event => {
		const checked = event.target instanceof HTMLInputElement && event.target.checked
		void runSocialWrite('translationPrefs', () => chatApi('/translation-prefs', {
			method: 'PUT',
			body: JSON.stringify({ prefs: { ...prefs, autoTranslate: checked } }),
		}))
	})
}

/**
 * @param {HTMLElement} panel 面板
 * @param {object} socialMeta meta
 * @returns {void}
 */
function renderPrivacySection(panel, socialMeta) {
	const section = document.createElement('section')
	section.className = 'settings-card card'
	section.innerHTML = `
		<h3 class="settings-card-title">${escapeHtml(geti18n('social.settings.privacyTitle'))}</h3>
		<p class="settings-hint">${escapeHtml(geti18n('social.settings.privacyHint'))}</p>
		<label class="settings-toggle">
			<input type="checkbox" id="exploreProtectedInput" ${socialMeta?.hideFromDiscovery ? 'checked' : ''} />
			<span>${escapeHtml(geti18n('social.profile.hideFromExplore'))}</span>
		</label>
	`
	panel.appendChild(section)
	section.querySelector('#exploreProtectedInput')?.addEventListener('change', async event => {
		const checked = event.target instanceof HTMLInputElement && event.target.checked
		await socialApi('/profile/meta', {
			method: 'POST',
			body: JSON.stringify({ hideFromDiscovery: checked }),
		})
		socialState.profileSocialMeta = {
			...socialState.profileSocialMeta,
			hideFromDiscovery: checked,
		}
	})
}

/**
 * @param {HTMLElement} panel 面板
 * @param {object} data taste 响应
 * @returns {void}
 */
function renderTasteSection(panel, data) {
	const tags = data.tags || []
	const publishPreferences = data.privacy?.publishPreferences !== false
	const publishReactions = data.privacy?.publishReactions !== false

	const section = document.createElement('section')
	section.className = 'settings-card card'
	section.innerHTML = `
		<h3 class="settings-card-title">${escapeHtml(geti18n('social.settings.tasteTitle'))}</h3>
		<p class="settings-hint">${escapeHtml(geti18n('social.settings.tasteHint'))}</p>
		<label class="settings-toggle">
			<input type="checkbox" id="tastePublishPreferences" ${publishPreferences ? 'checked' : ''} />
			<span>${escapeHtml(geti18n('social.taste.privacyPublishPreferences'))}</span>
		</label>
		<p class="settings-hint">${escapeHtml(geti18n('social.taste.privacyPublishPreferencesHint'))}</p>
		<label class="settings-toggle">
			<input type="checkbox" id="tastePublishReactions" ${publishReactions ? 'checked' : ''} />
			<span>${escapeHtml(geti18n('social.taste.privacyPublishReactions'))}</span>
		</label>
		<p class="settings-hint">${escapeHtml(geti18n('social.taste.privacyPublishReactionsHint'))}</p>
		<button type="button" id="tasteRebuildButton" class="btn btn-primary btn-sm">${escapeHtml(geti18n('social.taste.rebuild'))}</button>
	`
	panel.appendChild(section)

	/**
	 * @returns {Promise<void>}
	 */
	function persistPrivacy() {
		const prefs = section.querySelector('#tastePublishPreferences')
		const reactions = section.querySelector('#tastePublishReactions')
		return runSocialWrite('tastePrivacy', () => socialApi('/taste', {
			method: 'PUT',
			body: JSON.stringify({
				privacy: {
					publishPreferences: prefs instanceof HTMLInputElement ? prefs.checked : true,
					publishReactions: reactions instanceof HTMLInputElement ? reactions.checked : true,
				},
			}),
		}))
	}

	section.querySelector('#tastePublishPreferences')?.addEventListener('change', () => { void persistPrivacy() })
	section.querySelector('#tastePublishReactions')?.addEventListener('change', () => { void persistPrivacy() })
	section.querySelector('#tasteRebuildButton')?.addEventListener('click', () => {
		void runSocialWrite('tasteRebuild', () => socialApi('/taste/rebuild', { method: 'POST' }))
			.then(() => loadSettings())
	})

	const list = document.createElement('div')
	list.className = 'taste-list'
	if (!tags.length)
		list.innerHTML = `<p class="empty-hint">${escapeHtml(geti18n('social.taste.empty'))}</p>`
	else
		for (const tag of tags) {
			const row = document.createElement('article')
			row.className = 'taste-row card'
			const label = tag.label || formatHashShort(tag.tagHash, { headLen: 8, tailLen: 4 })
			row.innerHTML = `
				<div class="taste-row-main">
					<strong class="taste-label">${escapeHtml(label)}</strong>
					<span class="taste-hash">${escapeHtml(formatHashShort(tag.tagHash, { headLen: 10, tailLen: 6 }))}</span>
					<span class="taste-weight">${escapeHtml(geti18n('social.taste.weight', { weight: formatWeight(tag.weight) }))}</span>
				</div>
				<form class="taste-rename-form" data-tag-hash="${escapeHtml(tag.tagHash)}">
					<input type="text" maxlength="64" placeholder="${escapeHtml(geti18n('social.taste.namePlaceholder'))}" value="${escapeHtml(tag.label || '')}" />
					<button type="submit" class="btn btn-ghost btn-xs">${escapeHtml(geti18n('social.actions.setAlias'))}</button>
				</form>
			`
			list.appendChild(row)
		}
	section.appendChild(list)

	for (const form of list.querySelectorAll('.taste-rename-form'))
		form.addEventListener('submit', event => {
			event.preventDefault()
			const tagHash = form.getAttribute('data-tag-hash')
			const input = form.querySelector('input')
			const label = input instanceof HTMLInputElement ? input.value.trim() : ''
			if (!tagHash || !label) return
			void runSocialWrite('tasteName', () => socialApi('/taste/names', {
				method: 'POST',
				body: JSON.stringify({ tagHash, label, locale: navigator.language || 'zh-CN' }),
			})).then(() => loadSettings())
		})
}

/**
 * @param {HTMLElement} panel 面板
 * @returns {Promise<void>}
 */
async function renderSafetySection(panel) {
	const section = document.createElement('section')
	section.className = 'settings-card card'
	section.innerHTML = `
		<h3 class="settings-card-title">${escapeHtml(geti18n('social.settings.safetyTitle'))}</h3>
		<p class="settings-hint">${escapeHtml(geti18n('social.settings.safetyHint'))}</p>
		<div id="blocklistSection" class="profile-settings-blocklist"></div>
	`
	panel.appendChild(section)
	await renderBlocklist(section.querySelector('#blocklistSection'))
	section.addEventListener('click', async event => {
		const target = event.target
		if (!(target instanceof HTMLElement)) return
		const { handleProfileNavClick } = await import('../actions/profileNavActions.mjs')
		await handleProfileNavClick(target)
	})
}

/**
 * 加载社交设置视图。
 * @returns {Promise<void>}
 */
export async function loadSettings() {
	const panel = document.getElementById('settingsPanel')
	if (!panel) return
	const [taste, muted, profile] = await Promise.all([
		socialApi('/taste'),
		socialApi('/profile/muted-keywords'),
		socialState.viewerEntityHash
			? socialApi(`/profile/${socialState.viewerEntityHash}`).catch(() => ({}))
			: Promise.resolve({}),
	])
	const socialMeta = profile.socialMeta || socialState.profileSocialMeta || {}
	socialState.profileSocialMeta = socialMeta
	const mutedEntries = [...muted.entries || []]

	panel.replaceChildren()
	renderPrivacySection(panel, socialMeta)
	renderTasteSection(panel, taste)
	renderMutedKeywordsSection(panel, mutedEntries)
	await renderTranslationPrefsSection(panel)
	await renderSafetySection(panel)
	await initTranslations()
}

/** @deprecated 偏好已并入 settings；保留导出避免旧引用瞬时崩 */
export async function loadTaste() {
	await loadSettings()
}
