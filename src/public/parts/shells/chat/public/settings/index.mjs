import { initGroupSettings } from '/parts/shells:chat/src/groupSettings.mjs'

const hash = window.location.hash.slice(1)
const groupId = hash.startsWith('settings:') ? hash.split(':')[1] : ''
const backLink = document.getElementById('back-to-group-link')
if (backLink && groupId) 
	backLink.href = `/parts/shells:chat/hub/#group:${groupId}:default`


await initGroupSettings()

document.querySelectorAll('.tabs .tab').forEach((tab) => {
	tab.addEventListener('click', (e) => {
		const tabName = e.target.dataset.tab
		document.querySelectorAll('.tabs .tab').forEach((t) =>
			t.classList.remove('tab-active')
		)
		e.target.classList.add('tab-active')
		document.querySelectorAll('.tab-content').forEach((content) =>
			content.classList.add('hidden')
		)
		document.getElementById(`tab-${tabName}`)?.classList.remove('hidden')
	})
})
