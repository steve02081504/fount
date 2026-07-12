import fs from 'node:fs'
import path from 'node:path'

import webpush from 'npm:web-push'

import { getUserDictionary } from '../auth/index.mjs'
import { data_path } from '../server.mjs'
import { loadJsonFileIfExists, saveJsonFile } from '../../scripts/json_loader.mjs'

const VAPID_PATH = () => path.join(data_path, 'notify', 'vapid.json')

/**
 * @returns {Promise<{ publicKey: string, privateKey: string }>}
 */
export async function ensureVapidKeys() {
	const filePath = VAPID_PATH()
	const existing = loadJsonFileIfExists(filePath)
	if (existing?.publicKey && existing?.privateKey) {
		webpush.setVapidDetails('mailto:noreply@fount.local', existing.publicKey, existing.privateKey)
		return existing
	}
	const keys = webpush.generateVAPIDKeys()
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	saveJsonFile(filePath, keys)
	webpush.setVapidDetails('mailto:noreply@fount.local', keys.publicKey, keys.privateKey)
	return keys
}

/**
 * @param {string} username 用户
 * @returns {string} 订阅文件路径
 */
function pushSubscriptionsPath(username) {
	return path.join(getUserDictionary(username), 'notify', 'push_subscriptions.json')
}

/**
 * @param {string} username 用户
 * @returns {object[]} 订阅列表
 */
function loadPushSubscriptions(username) {
	const filePath = pushSubscriptionsPath(username)
	const data = loadJsonFileIfExists(filePath)
	return Array.isArray(data?.subscriptions) ? data.subscriptions : []
}

/**
 * @param {string} username 用户
 * @param {object[]} subscriptions 订阅列表
 * @returns {void}
 */
function savePushSubscriptions(username, subscriptions) {
	const filePath = pushSubscriptionsPath(username)
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	saveJsonFile(filePath, { subscriptions })
}

/**
 * @param {string} username 用户
 * @param {PushSubscriptionJSON} subscription Push 订阅
 * @returns {Promise<void>}
 */
export async function addPushSubscription(username, subscription) {
	const endpoint = String(subscription?.endpoint || '').trim()
	if (!endpoint) return
	const subscriptions = loadPushSubscriptions(username).filter(row => row.endpoint !== endpoint)
	subscriptions.push(subscription)
	savePushSubscriptions(username, subscriptions)
}

/**
 * @param {string} username 用户
 * @param {string} endpoint 订阅 endpoint
 * @returns {Promise<void>}
 */
export async function removePushSubscription(username, endpoint) {
	const normalized = String(endpoint || '').trim()
	if (!normalized) return
	const subscriptions = loadPushSubscriptions(username).filter(row => row.endpoint !== normalized)
	savePushSubscriptions(username, subscriptions)
}

/**
 * @param {string} username 用户
 * @param {{ title?: string, body?: string, url?: string, tag?: string }} payload 通知载荷
 * @returns {Promise<void>}
 */
export async function sendWebPush(username, payload) {
	await ensureVapidKeys()
	const subscriptions = loadPushSubscriptions(username)
	if (!subscriptions.length) return
	const body = JSON.stringify({
		title: payload.title || 'fount',
		body: payload.body || '',
		url: payload.url || '/',
		tag: payload.tag,
	})
	for (const subscription of [...subscriptions]) {
		try {
			await webpush.sendNotification(subscription, body)
		}
		catch (error) {
			const status = error?.statusCode
			if (status === 404 || status === 410)
				await removePushSubscription(username, subscription.endpoint)
		}
	}
}

/**
 * @returns {Promise<string>} VAPID 公钥
 */
export async function getVapidPublicKey() {
	const keys = await ensureVapidKeys()
	return keys.publicKey
}
