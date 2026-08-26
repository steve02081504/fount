/**
 * 资料卡锚点成员匹配：按 entityHash 主键命中本机，不得误命中首位远端。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { findMemberByEntityHash } from 'fount/public/parts/shells/chat/public/shared/memberByEntityHash.mjs'

const REMOTE = {
	entityHash: '33467ca1b0403203e765b969b11a4c84b0e2cf6ab41430d8db3bfe45d486fe8640550b51b6691ccb6ac1593e854710f08830ed7ac82cd7b77227d4fa8d57dd07',
	memberKey: '349e0fbd76b8836848224e919c9ed50e7e51c750914bde9837c2bdaa2b87bb7f',
	displayName: 'steve02081504',
}
const LOCAL = {
	entityHash: '459e503394f9aa0829ff2982a5203f850864dbe22fb6d286ab42e66eb29fbfdba51ca9de9469c1f82bb22ae744e963d20332ae02122a1927a3cbd69bae5ea419',
	memberKey: 'a01130eaeb975af09d1d29ac73099f224bff5fc454cc4a4e12fc79651d3fddfa',
	displayName: 'steve02081504',
}
const MEMBERS = [REMOTE, LOCAL]

Deno.test('消息头像：displayKey=本机 entityHash 命中 LOCAL 不误命中首位 REMOTE', () => {
	const hit = findMemberByEntityHash(MEMBERS, LOCAL.entityHash)
	assertEquals(hit?.entityHash, LOCAL.entityHash)
	assertEquals(hit?.entityHash === REMOTE.entityHash, false)
})

Deno.test('成员列表：本机 entityHash 命中 LOCAL', () => {
	assertEquals(findMemberByEntityHash(MEMBERS, LOCAL.entityHash)?.entityHash, LOCAL.entityHash)
})

Deno.test('远端 entityHash 命中 REMOTE', () => {
	assertEquals(findMemberByEntityHash(MEMBERS, REMOTE.entityHash)?.entityHash, REMOTE.entityHash)
})

Deno.test('空 / 未知 entityHash 返回 undefined', () => {
	assertEquals(findMemberByEntityHash(MEMBERS, ''), undefined)
	assertEquals(findMemberByEntityHash(MEMBERS, undefined), undefined)
	assertEquals(findMemberByEntityHash(MEMBERS, '0'.repeat(128)), undefined)
})

Deno.test('不得用 memberKey 当 entityHash 误匹配', () => {
	assertEquals(findMemberByEntityHash(MEMBERS, LOCAL.memberKey), undefined)
	assertEquals(findMemberByEntityHash(MEMBERS, REMOTE.memberKey), undefined)
})
