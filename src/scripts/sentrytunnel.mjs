import { FOUNT_SENTRY_DSN, sentry_enabled } from './sentry_state.mjs'

/** 本机配置的 Sentry 目标：入站 DSN 必须与其 host + project 完全一致。 */
const { hostname: configuredSentryHost, pathname: configuredSentryPath } = new URL(FOUNT_SENTRY_DSN)

/**
 * 将 Sentry 事件隧道传输到 Sentry 服务器。
 *
 * 只转发到本机配置的 Sentry 项目：入站 envelope 的 DSN 若指向其他主机则拒绝。
 * 否则任意未认证请求都能让服务器向攻击者指定的 https 主机发起 POST（SSRF）。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @param {import('npm:express').Response} res - Express 响应对象。
 * @returns {Promise<void>}
 */
export async function sentrytunnel(req, res) {
	if (!sentry_enabled) return res.status(200).json({ error: 'Sentry is disabled' })
	try {
		const envelopeBytes = req.body

		if (!envelopeBytes?.length)
			return res.status(400).json({ error: 'Empty request body' })

		const envelopeString = envelopeBytes.toString('utf-8')
		const [headerString] = envelopeString.split('\n')
		const header = JSON.parse(headerString)

		const dsnString = header.dsn
		if (!dsnString)
			return res.status(400).json({ error: 'DSN not found in envelope header' })

		let dsn
		try {
			dsn = new URL(dsnString)
		}
		catch {
			return res.status(400).json({ error: 'Invalid DSN in envelope header' })
		}

		if (dsn.hostname !== configuredSentryHost || dsn.pathname !== configuredSentryPath)
			return res.status(400).json({ error: 'DSN does not match the configured Sentry project' })

		const upstreamSentryUrl = `https://${configuredSentryHost}/api/${configuredSentryPath.substring(1)}/envelope/`

		const fetchResponse = await fetch(upstreamSentryUrl, {
			method: 'POST',
			body: envelopeBytes,
			headers: {
				'Content-Type': 'application/x-sentry-envelope',
			},
		})

		const responseBody = await fetchResponse.text()

		const upstreamContentType = fetchResponse.headers.get('content-type')
		if (upstreamContentType)
			res.setHeader('Content-Type', upstreamContentType)

		res.status(fetchResponse.status).send(responseBody)
	}
	catch (e) {
		console.error(e)
		return res.status(500).json({ error: 'Failed to tunnel event to Sentry' })
	}
}
