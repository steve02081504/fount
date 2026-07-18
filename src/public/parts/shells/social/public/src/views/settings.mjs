import { formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'
import { appendTemplate, mountTemplate, renderTemplate } from '/scripts/features/template.mjs'
import { initTranslations } from '/scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

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
 * @returns {Promise<void>}
 */
async function renderMutedKeywordsSection(panel, entries) {
	const section = await renderTemplate('settings_muted_keywords', {})
	panel.appendChild(section)

	const chips = section.querySelector('#mutedKeywordChips')
	/**
	 * @param {object[]} list 条目
	 * @returns {Promise<void>}
	 */
	async function paintChips(list) {
		chips.replaceChildren()
		if (!list.length) {
			await mountTemplate(chips, 'empty_hint', { i18nKey: 'social.settings.mutedKeywordsEmpty' })
			return
		}
		for (const entry of list) {
			const chip = document.createElement('button')
			chip.type = 'button'
			chip.className = 'muted-keyword-chip'
			chip.dataset.pattern = entry.pattern
			chip.dataset.i18n = 'social.settings.mutedKeywordsRemove'
			const tagHint = entry.matchTags === false ? '' : ' #Tag'
			chip.innerHTML = `<span>${escapeHtml(entry.pattern)}${escapeHtml(tagHint)}</span><span aria-hidden="true">×</span>`
			chips.appendChild(chip)
		}
	}
	await paintChips(entries)

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
		await paintChips(saved)
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
	const section = await renderTemplate('settings_auto_translate', {
		checkedAttr: prefs.autoTranslate ? 'checked' : '',
	})
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
 * @returns {Promise<void>}
 */
async function renderPrivacySection(panel, socialMeta) {
	const section = await renderTemplate('settings_privacy', {
		checkedAttr: socialMeta?.hideFromDiscovery ? 'checked' : '',
	})
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
 * @returns {Promise<void>}
 */
async function renderTasteSection(panel, data) {
	const tags = data.tags || []
	const publishPreferences = data.privacy?.publishPreferences !== false
	const publishReactions = data.privacy?.publishReactions !== false

	const section = await renderTemplate('settings_taste', {
		prefsCheckedAttr: publishPreferences ? 'checked' : '',
		reactionsCheckedAttr: publishReactions ? 'checked' : '',
	})
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

	const list = section.querySelector('[data-taste-list]')
	if (!(list instanceof HTMLElement)) return
	if (!tags.length)
		await mountTemplate(list, 'empty_hint', { i18nKey: 'social.taste.empty' })
	else
		for (const tag of tags) {
			const label = tag.label || formatHashShort(tag.tagHash, { headLen: 8, tailLen: 4 })
			await appendTemplate(list, 'settings_taste_row', {
				label: escapeHtml(label),
				labelValue: escapeHtml(tag.label || ''),
				tagHash: escapeHtml(tag.tagHash),
				tagHashShort: escapeHtml(formatHashShort(tag.tagHash, { headLen: 10, tailLen: 6 })),
				weight: formatWeight(tag.weight),
			})
		}

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
	const section = await renderTemplate('settings_safety', {})
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
		socialApi('/taste').catch(() => ({ tags: [], privacy: {} })),
		socialApi('/profile/muted-keywords').catch(() => ({ entries: [] })),
		socialState.viewerEntityHash
			? socialApi(`/profile/${socialState.viewerEntityHash}`).catch(() => ({}))
			: Promise.resolve({}),
	])
	const socialMeta = profile.socialMeta || socialState.profileSocialMeta || {}
	socialState.profileSocialMeta = socialMeta
	const mutedEntries = [...muted.entries || []]

	panel.replaceChildren()
	await renderPrivacySection(panel, socialMeta)
	await renderTasteSection(panel, taste)
	await renderMutedKeywordsSection(panel, mutedEntries)
	await renderTranslationPrefsSection(panel)
	await renderSafetySection(panel)
	await initTranslations()
}
