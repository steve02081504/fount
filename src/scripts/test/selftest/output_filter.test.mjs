/**
 * output_filter 钉死：噪声豁免窗口标记按行内匹配（并发子进程 stdall 按 chunk 交错，
 * 标记会被拼进行中）；stripNoiseMarkers 只删纯标记行，原始空行与行内残留内容保留。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	detectNoiseHits,
	formatNoiseAllowBegin,
	formatNoiseAllowEnd,
	stripNoiseMarkers,
} from '../core/output_filter.mjs'

Deno.test('stripNoiseMarkers drops marker-only lines and keeps surrounding content', () => {
	const begin = formatNoiseAllowBegin('char part not found')
	const end = formatNoiseAllowEnd()
	const text = ['before', '', `chunkA${begin}`, 'Error: char part not found', `chunkB${end}`, '', 'after'].join('\n')
	assertEquals(stripNoiseMarkers(text), ['before', '', 'chunkA', 'Error: char part not found', 'chunkB', '', 'after'].join('\n'))
	assertEquals(stripNoiseMarkers(`${begin}\nError: x\n${end}`), 'Error: x')
	assertEquals(stripNoiseMarkers('plain output\nstays intact'), 'plain output\nstays intact')
})

Deno.test('detectNoiseHits honors mid-line interleaved markers', () => {
	const begin = formatNoiseAllowBegin('char part not found')
	const end = formatNoiseAllowEnd()
	// begin/end 被拼进行中：整行按标记处理，窗口照常开合。
	assertEquals(detectNoiseHits(`boot ok${begin}\nError: char part not found\n${end}done`), [])
	// 窗口只豁免匹配 pattern 的行；关窗后的噪声仍命中。
	assertEquals(detectNoiseHits(`${begin}\nError: char part not found\n${end}\nError: real`), ['Error'])
	// 窗口外噪声正常命中。
	assertEquals(detectNoiseHits('Error: boom\nWARN: careful'), ['Error', 'WARN'])
})

Deno.test('detectNoiseHits flags window imbalance', () => {
	const begin = formatNoiseAllowBegin('char part not found')
	const end = formatNoiseAllowEnd()
	// 开窗未关：不匹配 pattern 的 `Error: x` 仍真命中， imbalance 追加在尾部。
	assertEquals(detectNoiseHits(`${begin}\nError: x`), ['Error', 'noise_allow_imbalance'])
	assertEquals(detectNoiseHits(`${end}`), ['noise_allow_imbalance'])
})
