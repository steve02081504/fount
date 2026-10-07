/* global Deno */
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param-type, jsdoc/require-param-description, jsdoc/require-returns */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertEquals } from 'jsr:@std/assert'

import { dispatchArgumentsResult } from '../../../scripts/part_invoke_result.mjs'

const fixturePath = name => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name)
const alpha = (await import(pathToFileURL(path.join(fixturePath('part_invoke_alpha'), 'main.mjs')))).default
const beta = (await import(pathToFileURL(path.join(fixturePath('part_invoke_beta'), 'main.mjs')))).default

Deno.test('run-js executes caller module with args, data, cwd and exit status', async () => {
	let text = ''
	const stdout = { write: value => { text += value } }
	const result = await alpha.interfaces.invokes.ArgumentsHandler('user', ['quoted value', '雪'])
	const status = await dispatchArgumentsResult({ result, partRoot: fixturePath('part_invoke_alpha') }, { stdout, cwd: '/chosen/workspace', ipcPort: 12345 })
	assertEquals(status, 7)
	assertEquals(text, `${JSON.stringify({ args: ['quoted value', '雪'], data: { source: 'alpha' }, cwd: '/chosen/workspace', ipcPort: 12345 })}\ncleanup\n`)
})

Deno.test('output and void keep their existing display paths', async () => {
	let text = ''
	let logged
	const options = { stdout: { write: (value, callback) => { text += value; callback() } }, logOutputs: value => { logged = value } }
	assertEquals(await dispatchArgumentsResult({ result: await beta.interfaces.invokes.ArgumentsHandler('user', ['hello', 'world']) }, options), 0)
	assertEquals(text, 'hello world\n')
	assertEquals(await dispatchArgumentsResult({ result: await beta.interfaces.invokes.ArgumentsHandler('user', ['void']), outputs: ['console'] }, options), 0)
	assertEquals(logged, ['console'])
})

Deno.test('output waits for stdout to finish writing', async () => {
	let finishWrite
	let settled = false
	const stdout = { write: (_value, callback) => { finishWrite = callback } }
	const pending = dispatchArgumentsResult({ result: { type: 'output', content: 'done' } }, { stdout }).then(() => { settled = true })
	await Promise.resolve()
	assertEquals(settled, false)
	finishWrite()
	await pending
	assertEquals(settled, true)
})
