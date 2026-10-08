/* eslint jsdoc/require-jsdoc: off, jsdoc/require-param: off, jsdoc/require-param-description: off, jsdoc/require-param-type: off, jsdoc/require-returns: off */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const wide = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u
const emoji = /\p{Extended_Pictographic}/u

export function cells(value) {
	let width = 0
	for (const { segment } of segmenter.segment(String(value))) width += wide.test(segment) || emoji.test(segment) ? 2 : 1
	return width
}

export function crop(value, width) {
	let result = ''
	let used = 0
	for (const { segment } of segmenter.segment(String(value))) {
		const size = cells(segment)
		if (used + size > width) break
		result += segment
		used += size
	}
	return result
}

export function pad(value, width) {
	const text = crop(value, width)
	return text + ' '.repeat(Math.max(0, width - cells(text)))
}

export function wrap(value, width) {
	const lines = []
	for (const sourceLine of String(value).split('\n')) {
		let line = ''
		for (const { segment } of segmenter.segment(sourceLine)) {
			if (cells(line) + cells(segment) > width && line) {
				lines.push(line)
				line = ''
			}
			line += segment
		}
		lines.push(line)
	}
	return lines
}

export function sliceCells(value, start, end) {
	let column = 0
	let result = ''
	for (const { segment } of segmenter.segment(String(value))) {
		const next = column + cells(segment)
		if (next > start && column < end) result += segment
		column = next
		if (column >= end) break
	}
	return result
}

// 替换一段单元格：两端都不劈开宽字素，结果补齐到 totalWidth。
export function replaceCells(value, start, width, replacement, totalWidth) {
	let column = 0
	let left = ''
	let right = ''
	let rightStart = null
	for (const { segment } of segmenter.segment(String(value))) {
		const next = column + cells(segment)
		if (next <= start) left += segment
		else if (column >= start + width) { rightStart ??= column; right += segment }
		column = next
	}
	const suffixWidth = Math.max(0, totalWidth - start - width)
	return pad(left, start) + pad(replacement, width) + pad(' '.repeat(Math.max(0, (rightStart ?? start + width) - start - width)) + right, suffixWidth)
}
