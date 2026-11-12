/**
 * Request bodies with a hard size limit (spec §30). The Content-Length header is a promise the
 * client may not make (a chunked upload sends none) or may not keep, so the body is counted as it
 * arrives and the read stops at the limit instead of holding whatever was sent in memory.
 */
export type BodyBytes = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' | 'invalid' };
export type JsonBody = { ok: true; value: unknown } | { ok: false; reason: 'too_large' | 'invalid' };

export async function readBodyBytes(request: Request, maxBytes: number): Promise<BodyBytes> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return { ok: false, reason: 'too_large' };
  if (!request.body) return { ok: false, reason: 'invalid' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  const body = await readBodyBytes(request, maxBytes);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body.bytes)) };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
