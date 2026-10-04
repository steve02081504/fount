/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { detectPlatform, getInstallGuide, selectLocalVerificationResponse } from '../captcha/install_guide.mjs'

Deno.test('verification guide detects mobile, desktop, and unknown platforms', () => {
	assertEquals(detectPlatform('Mozilla/5.0 (Linux; Android 14)'), 'android')
	assertEquals(detectPlatform('Mozilla/5.0 (Windows NT 10.0)', 'Win32'), 'windows')
	assertEquals(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'MacIntel'), 'mac')
	assertEquals(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64'), 'linux')
	assertEquals(detectPlatform('Browser/1.0', 'Unknown'), 'unknown')
})

Deno.test('verification guide uses installers that launch background keepalive mode', () => {
	assertEquals(
		getInstallGuide('android').command,
		'curl -fsSL https://steve02081504.github.io/subfount/install.sh | bash -s -- background keepalive',
	)
	assertEquals(
		getInstallGuide('windows').command,
		'pwsh.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://steve02081504.github.io/subfount/install.ps1))) background keepalive"',
	)
	assertEquals(getInstallGuide('mac').command, getInstallGuide('linux').command)
})

Deno.test('local verification accepts subfount success even when fount reports failure', () => {
	const nodeHash = 'a'.repeat(64)
	assertEquals(
		selectLocalVerificationResponse([
			{ status: 'fulfilled', value: { status: 'failed', reason: 'not reachable' } },
			{ status: 'fulfilled', value: { status: 'verified', nodeHash } },
		], value => typeof value === 'string' && /^[\da-f]{64}$/i.test(value)),
		{ status: 'verified', nodeHash },
	)
})
