export async function sentrytunnel(req, res) {
	try {
		const envelopeBytes = req.body

		if (!envelopeBytes || envelopeBytes.length === 0)
			return res.status(400).json({ error: 'Empty request body' })

		const envelopeString = envelopeBytes.toString('utf-8')
		const [headerString] = envelopeString.split('\n')
		const header = JSON.parse(headerString)

		const dsnString = header.dsn
		if (!dsnString)
			return res.status(400).json({ error: 'DSN not found in envelope header' })

		const dsn = new URL(dsnString)
		const sentryHost = dsn.hostname
		const projectId = dsn.pathname.substring(1)

		if (!sentryHost || !projectId)
			return res.status(400).json({ error: 'Invalid DSN in envelope header' })

		const upstreamSentryUrl = `https://${sentryHost}/api/${projectId}/envelope/`

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
	} catch (e) {
		console.error(e)
		return res.status(500).json({ error: 'Failed to tunnel event to Sentry' })
	}
}
