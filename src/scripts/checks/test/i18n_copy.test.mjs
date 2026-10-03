/**
 * `i18n_copy`：文案层的机器味 / 同步残渣检查。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../test/core/repo_root.mjs'
import { checkLeaf, flattenLocale, scanLocaleCopy, scanRepoLocaleCopy } from '../i18n_copy.mjs'

Deno.test('flattenLocale walks objects and arrays', () => {
	const flat = flattenLocale({ a: { b: 'x', c: ['y'], d: { switch: 'n', cases: { 1: 'z' } } } })
	assertEquals([...flat.keys()].sort(), ['a.b', 'a.c[0]', 'a.d.cases.1'])
})

Deno.test('checkLeaf flags null, empty and brand mangling', () => {
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: null, source: 'x' })[0].rule, 'null')
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: '', source: 'x' })[0].rule, 'empty')
	assertEquals(checkLeaf({ locale: 'ja-JP', key: 'installer_wait_screen.data_showcase.title_of', value: '', source: '的' }), [])
	const brand = checkLeaf({ locale: 'nl-NL', key: 'k', value: 'Start font opnieuw', source: '重启 fount' })
	assertEquals(brand.map(hit => hit.rule), ['brand'])
	assertEquals(checkLeaf({ locale: 'nl-NL', key: 'k', value: 'font-family: serif', source: 'fount 字体' }), [])
	assertEquals(checkLeaf({ locale: 'fr-FR', key: 'k', value: 'ils font la promotion', source: 'fount 推广' }), [])
	assertEquals(checkLeaf({ locale: 'it-IT', key: 'k', value: 'fonte://x', source: 'fount:// x' })[0].rule, 'brand')
})

Deno.test('checkLeaf flags broken compounds but not flags or elisions', () => {
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'das fount -Browser -Skript', source: '' }).length, 2)
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'fount eval -f <file>', source: '' }), [])
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'Menü - dies und das', source: '' }), [])
	assertEquals(checkLeaf({ locale: 'nl-NL', key: 'k', value: 'gebruikersnaam en -wachtwoord', source: '' }), [])
})

Deno.test('checkLeaf flags whitespace frame drift and punctuation', () => {
	const newline = checkLeaf({ locale: 'ru-RU', key: 'k', value: '>>> run', source: '\n>>> run' })
	assertEquals(newline.map(hit => hit.rule), ['whitespace'])
	assertEquals(checkLeaf({ locale: 'ar-SA', key: 'k', value: '[Y/N]', source: '[Y/N] ' }).map(hit => hit.rule), ['whitespace'])
	assertEquals(checkLeaf({ locale: 'es-ES', key: 'k', value: '${a} , ${b}', source: '' }).map(hit => hit.rule), ['punctuation'])
	assertEquals(checkLeaf({ locale: 'ko-KR', key: 'k', value: '설명 : ${x}', source: '描述：${x}' }).map(hit => hit.rule), ['punctuation'])
	assertEquals(checkLeaf({ locale: 'es-ES', key: 'k', value: '¿Por qué...?', source: '' }), [])
})

Deno.test('scanLocaleCopy skips zh-CN and reports per locale', () => {
	const issues = scanLocaleCopy({
		'zh-CN': { a: 'fount 是' },
		'de-DE': { a: 'font ist' },
	})
	assertEquals(issues.map(issue => `${issue.locale}:${issue.rule}`), ['de-DE:brand'])
})

Deno.test('repo: locale copy carries no machine-translation residue', async () => {
	const { issues } = await scanRepoLocaleCopy(REPO_ROOT)
	assertEquals(issues, [], issues.slice(0, 40)
		.map(issue => `${issue.locale} ${issue.key} [${issue.rule}] ${issue.detail}`)
		.join('\n'))
})
