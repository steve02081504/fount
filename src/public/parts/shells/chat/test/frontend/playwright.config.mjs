import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPlaywrightConfig } from '../../../../../../../.github/workflows/test_lib/playwright_config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 *
 */
export default await createPlaywrightConfig({
	testDir: __dirname,
	overrides: {
		timeout: 300_000,
		projects: [
			{ name: 'deeplink', testMatch: 'deepLink.spec.mjs' },
			{
				name: 'hub',
				testMatch: 'hubE2E.spec.mjs',
				dependencies: ['deeplink'],
			},
			{
				name: 'shell',
				testMatch: ['smoke.spec.mjs', 'profile.spec.mjs'],
				dependencies: ['hub'],
			},
		],
	},
})
