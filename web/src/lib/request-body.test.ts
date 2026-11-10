import { describe, expect, it } from 'vitest';
import { readJsonBody } from './request-body';

/** A request whose body arrives in pieces with no Content-Length, as a chunked upload does. */
function chunked(parts: string[]) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
  return new Request('http://localhost/api', { method: 'PUT', body, duplex: 'half' } as RequestInit & { duplex: 'half' });
}

describe('request bodies with a size limit', () => {
  it('reads JSON within the limit', async () => {
    expect(await readJsonBody(chunked(['{"a":', '1}']), 100)).toEqual({ ok: true, value: { a: 1 } });
  });

  it('stops at the limit when no length is declared', async () => {
    expect(await readJsonBody(chunked(['{"a":"', 'x'.repeat(80), '"}']), 50)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('refuses a declared length over the limit without reading', async () => {
    const request = new Request('http://localhost/api', { method: 'PUT', body: '{}', headers: { 'content-length': '999' } });
    expect(await readJsonBody(request, 50)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('calls a body that is not JSON invalid', async () => {
    expect(await readJsonBody(chunked(['not json']), 100)).toEqual({ ok: false, reason: 'invalid' });
  });
});
