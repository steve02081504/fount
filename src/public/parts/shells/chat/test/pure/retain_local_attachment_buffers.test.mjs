/**
 * retainLocalAttachmentBuffers：按 fileId / name+mime 合并本地 buffer。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { retainLocalAttachmentBuffers } from '../../public/shared/retainLocalAttachmentBuffers.mjs'

Deno.test('retainLocalAttachmentBuffers: fileId match removes same buffer from name/mime queue', () => {
	const previous = {
		content: {
			files: [
				{ fileId: 'id-a', name: 'shot.png', mime_type: 'image/png', buffer: 'buf-with-id' },
				{ name: 'shot.png', mime_type: 'image/png', buffer: 'buf-no-id' },
			],
		},
	}
	const next = {
		content: {
			files: [
				{ fileId: 'id-a', name: 'shot.png', mime_type: 'image/png' },
				{ name: 'shot.png', mime_type: 'image/png' },
			],
		},
	}
	const merged = retainLocalAttachmentBuffers(previous, next)
	assertEquals(merged.content.files[0].buffer, 'buf-with-id')
	assertEquals(merged.content.files[1].buffer, 'buf-no-id')
})

Deno.test('retainLocalAttachmentBuffers: duplicate video name keeps distinct buffers via fileId then fallback', () => {
	const previous = {
		content: {
			files: [
				{ fileId: 'vid-1', name: 'clip.mp4', mime_type: 'video/mp4', buffer: 'video-a' },
				{ name: 'clip.mp4', mime_type: 'video/mp4', buffer: 'video-b' },
			],
		},
	}
	const next = {
		content: {
			files: [
				{ fileId: 'vid-1', name: 'clip.mp4', mime_type: 'video/mp4' },
				{ name: 'clip.mp4', mime_type: 'video/mp4' },
			],
		},
	}
	const merged = retainLocalAttachmentBuffers(previous, next)
	assertEquals(merged.content.files.map(file => file.buffer), ['video-a', 'video-b'])
})
