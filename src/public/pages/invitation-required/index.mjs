import { getInvitationStatus, submitInvitation, acceptSelfInvitation } from '/parts/shells:home/src/endpoints.mjs'
import { initTranslations, setElementI18n } from '/scripts/i18n/index.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'

applyTheme()
await initTranslations('invitation-required')

const form = document.getElementById('invitation-form')
const field = document.getElementById('invitation-link')
const submit = document.getElementById('invitation-submit')
const status = document.getElementById('invitation-status')
let polling = null

/**
 * 显示本地化进度。
 * @param {string} key 文案键
 * @returns {void}
 */
function say(key) {
	setElementI18n(status, key)
}

/**
 * 刷新等待状态并在完成时进入主页。
 * @returns {Promise<object>} 当前进度
 */
async function refresh() {
	const result = await getInvitationStatus()
	if (result.invited) {
		if (polling) clearInterval(polling)
		say('invitation-required.success')
		window.location.replace('/parts/shells:home/')
	}
	else if (result.pending) say('invitation-required.waiting')
	return result
}

form.addEventListener('submit', async event => {
	event.preventDefault()
	submit.disabled = true
	try {
		await submitInvitation(field.value.trim())
		say('invitation-required.waiting')
		if (polling) clearInterval(polling)
		polling = setInterval(() => refresh().catch(() => say('invitation-required.error')), 3000)
		await refresh()
	}
	catch { say('invitation-required.error') }
	finally { submit.disabled = false }
})

const sequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']
let position = 0
document.addEventListener('keydown', async event => {
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
	position = key === sequence[position] ? position + 1 : key === sequence[0] ? 1 : 0
	if (position !== sequence.length) return
	position = 0
	try {
		await acceptSelfInvitation()
		await refresh()
	}
	catch { say('invitation-required.error') }
})

refresh().then(result => {
	if (result.pending) polling = setInterval(() => refresh().catch(() => say('invitation-required.error')), 3000)
}).catch(() => say('invitation-required.error'))
