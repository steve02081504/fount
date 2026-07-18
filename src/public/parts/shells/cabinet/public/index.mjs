import { initTranslations, console } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { usingTemplates } from '/scripts/features/template.mjs'
import { createReadyGate } from '/scripts/test/ready_gate.mjs'

usingTemplates('/parts/shells:cabinet/src/templates')

import { CABINET_APP_GATE } from './src/gate.mjs'
import { bootFromHash, refreshCabinets } from './src/navigation.mjs'
import { wireBootstrap } from './src/wiring.mjs'

await initTranslations()

const cabinetGate = createReadyGate(CABINET_APP_GATE)
cabinetGate.markPending()

wireBootstrap()
try {
	await refreshCabinets()
	await bootFromHash()
	window.addEventListener('hashchange', () => void bootFromHash())
	cabinetGate.markReady()
}
catch (error) {
	console.error(error)
	cabinetGate.markFailed(error)
	showToastI18n('error', 'cabinet.bootstrapFailed', { error: error.message })
}
