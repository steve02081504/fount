/**
 * Deskpet 引导页跳转校验纯逻辑：同源保留、裸 `%` 不抛、跨源拒绝。
 */
import { test, expect } from './fixtures.mjs'

test.describe('Deskpet redirect helper', () => {
	test('resolves same-origin redirects and rejects cross-origin', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { resolveRedirect } = await import('/parts/shells:deskpet/src/redirect.mjs')
			const origin = 'http://localhost:8931'
			return {
				same: resolveRedirect('/parts/shells:deskpet/?char=100%25', origin),
				rawPercent: resolveRedirect('/parts/shells:deskpet/?char=100%', origin),
				cross: (() => {
					try {
						return resolveRedirect('https://example.com/', origin)
					}
					catch (error) {
						return error.message
					}
				})(),
			}
		})
		expect(result.same).toBe('http://localhost:8931/parts/shells:deskpet/?char=100%25')
		expect(result.rawPercent).toContain('100%')
		expect(result.cross).toBe('Invalid redirect')
	})
})
