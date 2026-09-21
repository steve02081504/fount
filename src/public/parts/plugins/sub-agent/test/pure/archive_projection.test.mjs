/* global Deno */
/**
 * sub-agent 父代档案投影的纯函数测试：字段裁剪、尾部截取与顺序。
 */
import { assertEquals } from 'jsr:@std/assert'

import { projectArchiveEntries } from '../../archive.mjs'

/**
 * 构造一条带多余字段的聊天记录。
 * @param {number} index 序号
 * @returns {object} 聊天记录条目
 */
function entry(index) {
	return {
		id: `id-${index}`,
		name: `name-${index}`,
		uid: `uid-${index}`,
		role: index % 2 ? 'char' : 'user',
		time_stamp: index * 1000,
		content: `content-${index}`,
		files: [{ name: 'secret.bin', buffer: 'ignored' }],
		extension: { huge: 'ignored' },
	}
}

Deno.test('projectArchiveEntries keeps only the serializable projection fields', () => {
	const projected = projectArchiveEntries([entry(0)], 50)
	assertEquals(Object.keys(projected[0]).sort(), ['content', 'name', 'role', 'time_stamp', 'uid'])
	assertEquals(projected[0], {
		role: 'user',
		name: 'name-0',
		uid: 'uid-0',
		time_stamp: 0,
		content: 'content-0',
	})
})

Deno.test('projectArchiveEntries takes the last N entries in original order', () => {
	const projected = projectArchiveEntries([entry(0), entry(1), entry(2), entry(3)], 2)
	assertEquals(projected.map(item => item.content), ['content-2', 'content-3'])
})

Deno.test('projectArchiveEntries tolerates empty or missing logs', () => {
	assertEquals(projectArchiveEntries(undefined), [])
	assertEquals(projectArchiveEntries([]), [])
	assertEquals(projectArchiveEntries([{}]), [{ role: 'system', name: '', uid: '', time_stamp: null, content: '' }])
})
