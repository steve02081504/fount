# AI Generator Usage, Pricing & Attachment Conversion

Contracts every AI source must keep when it reports usage or converts attachments. Overview: [AGENTS.md](../AGENTS.md).

## Reported usage

Response `extension.usage = { calls, total }` contains provider-reported counts only. Each call uses `inputTokens` (inclusive of cache reads/writes), `cacheReadTokens`, `cacheWriteTokens`, `outputTokens` (inclusive of reasoning), and optional `reasoningTokens`, `source`, `model`, `purpose`. Unknown fields stay absent. The recorder in `proxy/src/usage.mjs` replaces cumulative stream snapshots for one call and appends one independent call per request; shared `chat/public/shared/usage.mjs` aggregates calls. Reused `base_result` retains prior calls. Studio callers slice off prior calls before recording a request. Sources that do not report usage produce no fabricated count.

## Token pricing

Optional source config `pricing` specifies currency and per-million-token rates, for example `{ "currency": "USD", "input": 1, "cacheRead": 0.1, "cacheWrite": 1.25, "output": 4 }`. A call stores its price snapshot and computed `cost` only when all needed counts/rates are known. An unknown cache split is still priced when that category's own rate equals the input rate (a uniform input tariff, i.e. all three identical, needs no cache breakdown at all). Missing pricing produces no money; aggregate `total.costs` sums known costs separately by currency. These are configured token costs, not subscription charges or non-token tool charges. Chat Completions, Responses, Anthropic, Gemini/Vertex, Bedrock Converse, Cohere and Ollama capture usage; cookie/web sources remain unmetered when their responses contain no usage. Wrapper sources preserve the actual inner call usage without pricing it again.

## Performance telemetry

`createUsageRecorder` also appends one `extension.modelCalls` interval per actual request, even when provider usage is absent. Call `firstOutput()` only for nonempty streamed model content/reasoning/tool arguments; never for headers, role-only events, or nonstream responses. Enclose connection/HTTP/stream parsing in `try/catch/finally`: `fail(error)` records failure or abort and `apply()` seals the interval and any reported usage idempotently. Performance counts remain independent of billing; local generation may report its actual tokenizer output count there without inventing provider usage. Preserve `modelCalls` across reused `base_result` rounds and wrapper sources.

## Attachment conversion

Top-level `allowed_mime_types` is an exact MIME list, like Gemini (`null`/absent = as-is; `[]` = allow nothing). Allowed attachments keep their bytes. [proxy/src/attachmentConversion.mjs](../proxy/src/attachmentConversion.mjs) converts disallowed images to the first encodable image MIME in list order with lazy `npm:sharp` (first frame, orientation applied; JPEG transparency flattened to white), and supports UTF-8 text conversion and equivalent MIME aliases. No suitable converter, decoding failure, or content unrepresentable in the request becomes a system notice. Audio/video transcoding has no in-process converter yet. `BuildPrompt` and requests share the conversion; original files and MIME-based ignore/role policies stay unchanged. Assistant-file error hints apply only to Chat Completions failures, since Responses already spills assistant attachments to user messages.
