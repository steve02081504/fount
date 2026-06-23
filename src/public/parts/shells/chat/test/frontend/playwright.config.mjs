import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPlaywrightConfig } from 'fount/scripts/test/playwright/config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Chat 前端 Playwright 多阶段配置。
 */
export default await createPlaywrightConfig({
	testDir: __dirname,
	overrides: {
		timeout: 300_000,
		projects: [
			{ name: 'deeplink', testMatch: 'deepLink.spec.mjs' },
			{
				name: 'hub-ui',
				testMatch: ['composer.spec.mjs', 'navigation.spec.mjs', 'messageActions.spec.mjs'],
			},
			{ name: 'hub', testMatch: 'hubE2E.spec.mjs' },
			{ name: 'secondary', testMatch: 'secondaryPages.spec.mjs' },
			{ name: 'shell', testMatch: ['smoke.spec.mjs', 'profile.spec.mjs'] },
		],
	},
})
