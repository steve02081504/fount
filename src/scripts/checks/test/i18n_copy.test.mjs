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

Deno.test('checkLeaf flags invisible junk and doubled spaces', () => {
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'Alias \u200b\u200bfestlegen', source: 'x' }).map(hit => hit.rule), ['invisible'])
	assertEquals(checkLeaf({ locale: 'emoji', key: 'k', value: '👨\u200d💻', source: 'x' }), [])
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'Meilensteine  und Erfolge', source: 'x' }).map(hit => hit.rule), ['spacing'])
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'a  b', source: 'a  b' }), [])
})

Deno.test('checkLeaf flags letters from a foreign writing system', () => {
	assertEquals(checkLeaf({ locale: 'hi-IN', key: 'k', value: 'कंपोनент पथ', source: '组件路径' }).map(hit => hit.rule), ['script'])
	assertEquals(checkLeaf({ locale: 'hi-IN', key: 'k', value: 'कंपोनेंट पथ', source: '组件路径' }), [])
	assertEquals(checkLeaf({ locale: 'ja-JP', key: 'k', value: '漢字とかな', source: '汉字和假名' }), [])
	assertEquals(checkLeaf({ locale: 'emoji', key: 'k', value: 'Σ⏳≈ ${remaining}', source: '剩余 ${remaining}' }), [])
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'fount läuft', source: 'fount 运行中' }), [])
})

Deno.test('checkLeaf keeps the literal CLI tokens of the source', () => {
	const missing = checkLeaf({ locale: 'es-ES', key: 'k', value: 'Usa "fount run <ruta> <parámetros...>"', source: '用 "fount run <组件路径> <参数...>"（或 fount runas <用户名> <组件路径>）' })
	assertEquals(missing.map(hit => hit.detail), ['dropped the literal token "fount runas"'])
	assertEquals(checkLeaf({ locale: 'es-ES', key: 'k', value: 'Usa "fount run <ruta> <parámetros...>" (o "fount runas <usuario> <ruta>")', source: '用 "fount run <组件路径> <参数...>"（或 fount runas <用户名> <组件路径>）' }), [])
	assertEquals(checkLeaf({ locale: 'ar-SA', key: 'k', value: 'الاستخدام: --suite <name> | --قائمة', source: '用法：--suite <名称> | --list' }).map(hit => hit.rule), ['literal'])
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'Nur das lokale Archiv/*.jsonl wird gelöscht.', source: '仅删除本地 archive/*.jsonl。' }).map(hit => hit.rule), ['literal'])
	assertEquals(checkLeaf({ locale: 'fr-FR', key: 'k', value: 'une adresse wss :// par ligne', source: '每行填写一个 wss:// 地址' }).map(hit => hit.rule), ['literal'])
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'Nur die lokale archive/*.jsonl wird gelöscht.', source: '仅删除本地 archive/*.jsonl。' }), [])
})

Deno.test('checkLeaf keeps backticked literals but honours the reference rewrite', () => {
	const dropped = checkLeaf({ locale: 'de-DE', key: 'k', value: 'Git Pull überspringen', source: '跳过 `git pull`', reference: 'skipping `git pull`' })
	assertEquals(dropped.map(hit => hit.rule), ['literal'])
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: '`git pull` überspringen', source: '跳过 `git pull`', reference: 'skipping `git pull`' }), [])
	// the reference translation dropped it too: a deliberate rewrite, not drift
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'Hallo!', source: '`// "hello fount!"`', reference: 'Hello!' }), [])
	// a keyboard shortcut may be capitalised
	assertEquals(checkLeaf({ locale: 'zh-TW', key: 'k', value: '按 `Ctrl+S` 儲存', source: '按`ctrl+s`保存', reference: 'press `ctrl+s`' }), [])
})

Deno.test('checkLeaf flags a translated product name', () => {
	assertEquals(checkLeaf({ locale: 'nl-NL', key: 'k', value: 'Start de fontein opnieuw', source: '重启 fount' }).map(hit => hit.rule), ['brand'])
	assertEquals(checkLeaf({ locale: 'nl-NL', key: 'k', value: 'Start fount opnieuw', source: '重启 fount' }), [])
	// inflected spellings count too (Icelandic declines the name)
	assertEquals(checkLeaf({ locale: 'is-IS', key: 'k', value: 'Velkomin á þröskuld fontsins.', source: '欢迎来到 fount' }).map(hit => hit.rule), ['brand'])
	assertEquals(checkLeaf({ locale: 'is-IS', key: 'k', value: 'Velkomin á þröskuld founts.', source: '欢迎来到 fount' }), [])
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'Starte den Brunnen', source: '重启 fount' }), [])
	// kana never matches the font root, so ja-JP carries its own aliases
	assertEquals(checkLeaf({ locale: 'ja-JP', key: 'k', value: 'フォントを再起動', source: '重启 fount' }).map(hit => hit.rule), ['brand'])
	assertEquals(checkLeaf({ locale: 'ja-JP', key: 'k', value: 'fount を再起動', source: '重启 fount' }), [])
	// pt-PT says "fonte" for a source; its real brand slips are literal-token hits
	assertEquals(checkLeaf({ locale: 'pt-PT', key: 'k', value: 'conteúdo de fonte aberta', source: '开源 fount 内容' }), [])
})

Deno.test('checkLeaf flags untranslated English left in a value', () => {
	assertEquals(checkLeaf({ locale: 'pt-PT', key: 'k', value: 'Eliminar this month before', source: '删除此月之前' }).map(hit => hit.rule), ['english'])
	assertEquals(checkLeaf({ locale: 'fr-FR', key: 'k', value: 'Eliminar os anteriores a este mês', source: '删除此月之前' }), [])
	// 借词惯用语在本语言里合法（德语/荷兰语还写成 Drag-and-Drop）
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'Kein geeigneter Drag-and-Drop-Handler gefunden.', source: '未找到合适的拖放处理器' }), [])
	// 源文没有汉字时不判（英文键名、纯符号的值）
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'Open the file', source: 'Open the file' }), [])
})

Deno.test('checkLeaf keeps a literal ID example', () => {
	const id = checkLeaf({ locale: 'de-DE', key: 'k', value: 'Group_1776941580949_xxxx', source: 'group_1776941580949_xxxx' })
	assertEquals(id.map(hit => hit.rule), ['literal'])
	assertEquals(checkLeaf({ locale: 'de-DE', key: 'k', value: 'group_1776941580949_xxxx', source: 'group_1776941580949_xxxx' }), [])
})

Deno.test('checkLeaf keeps camel-case identifiers', () => {
	const hit = checkLeaf({ locale: 'ar-SA', key: 'k', value: 'ميزانية الرغبات', source: '单一 wantIds 预算' })
	assertEquals(hit.map(item => item.rule), ['identifier'])
	assertEquals(scanLocaleCopy({
		'zh-CN': { a: '单一 wantIds 预算' },
		'en-UK': { a: 'single wantIds budget' },
		'ar-SA': { a: 'ميزانية الرغبات' },
	}).map(issue => issue.rule), ['identifier'])
	assertEquals(scanLocaleCopy({
		'zh-CN': { a: '单一 wantIds 预算' },
		'en-UK': { a: 'single wantIds budget' },
		'ar-SA': { a: 'ميزانية wantIds' },
	}).length, 0)
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
