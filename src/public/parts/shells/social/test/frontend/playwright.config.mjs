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
			{
				name: 'actions',
				testMatch: ['postActions.spec.mjs', 'replies.spec.mjs'],
			},
			{
				name: 'core',
				testMatch: ['composer.spec.mjs', 'deepLink.spec.mjs', 'feed.spec.mjs', 'navigation.spec.mjs', 'profile.spec.mjs', 'saved.spec.mjs'],
			},
			{
				name: 'tail',
				testMatch: ['smoke.spec.mjs', 'views.spec.mjs'],
			},
		],
	},
})
