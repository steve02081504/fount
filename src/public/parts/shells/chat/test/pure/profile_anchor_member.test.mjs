/**
 * 资料卡锚点成员匹配：悬停本机头像不得因 pubKeyHash 空值误命中首位远端成员。
 */
/* global Deno */
import { findMemberForProfileAnchor } from 'fount/public/parts/shells/chat/public/shared/profileAnchorMember.mjs'
import { assertEquals } from 'jsr:@std/assert'

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

Deno.test('消息头像悬停：displayKey=本机 entityHash 且无 memberItem 时命中本机，不误命中首位远端', () => {
	// 复现：成员无 pubKeyHash、消息锚点无 memberKey → 旧逻辑 `undefined === undefined` 命中首位
	const hit = findMemberForProfileAnchor(MEMBERS, {
		displayKey: LOCAL.entityHash,
		memberKey: undefined,
		authorHash: LOCAL.memberKey,
	})
	assertEquals(hit?.entityHash, LOCAL.entityHash)
})

Deno.test('成员列表悬停：本机 entityHash 命中本机（authorHash 亦空）', () => {
	const hit = findMemberForProfileAnchor(MEMBERS, {
		displayKey: LOCAL.entityHash,
		memberKey: LOCAL.memberKey,
		authorHash: undefined,
	})
	assertEquals(hit?.entityHash, LOCAL.entityHash)
})

Deno.test('pubKeyHash 为 null 时同样不得靠空右侧键误匹配', () => {
	const withNullPk = [
		{ ...REMOTE, pubKeyHash: null },
		{ ...LOCAL, pubKeyHash: null },
	]
	assertEquals(
		findMemberForProfileAnchor(withNullPk, {
			displayKey: LOCAL.entityHash,
			memberKey: undefined,
			authorHash: LOCAL.memberKey,
		})?.entityHash,
		LOCAL.entityHash,
	)
})

Deno.test('仍可用 memberKey / pubKeyHash 解析', () => {
	const withPk = [
		{ ...REMOTE, pubKeyHash: REMOTE.memberKey },
		{ ...LOCAL, pubKeyHash: LOCAL.memberKey },
	]
	assertEquals(
		findMemberForProfileAnchor(withPk, {
			displayKey: LOCAL.entityHash,
			memberKey: undefined,
			authorHash: LOCAL.memberKey,
		})?.entityHash,
		LOCAL.entityHash,
	)
	assertEquals(
		findMemberForProfileAnchor(withPk, {
			displayKey: LOCAL.memberKey,
			memberKey: undefined,
			authorHash: undefined,
		})?.entityHash,
		LOCAL.entityHash,
	)
})
