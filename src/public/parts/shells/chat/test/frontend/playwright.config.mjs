import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPlaywrightConfig } from '../../../../../../scripts/test/playwright_config.mjs'

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
				name: 'hub-core',
				testMatch: ['composer.spec.mjs', 'navigation.spec.mjs', 'messageActions.spec.mjs'],
				dependencies: ['deeplink'],
			},
			{
				name: 'hub',
				testMatch: 'hubE2E.spec.mjs',
				dependencies: ['hub-core'],
			},
			{
				name: 'secondary',
				testMatch: 'secondaryPages.spec.mjs',
				dependencies: ['hub-core'],
			},
			{
				name: 'shell',
				testMatch: ['smoke.spec.mjs', 'profile.spec.mjs'],
				dependencies: ['hub', 'secondary'],
			},
		],
	},
})
