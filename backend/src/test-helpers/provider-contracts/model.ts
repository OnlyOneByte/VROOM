import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { ModelProviderSettings } from '../../api/providers/domains/model/model-registry';
import { ALLOW_PRIVATE, outboundResolver, urlForAddress } from '../../utils/outbound-url';

export interface ModelContractSubject<P> {
  create: (settings: ModelProviderSettings) => P;
  invoke: (instance: P) => Promise<unknown>;
  okResponse: unknown;
  path: string;
  credential: { header: string; value: (key: string) => string } | { query: string };
}

interface SeenRequest {
  method: string;
  path: string;
  contentType: string | null;
  headers: Headers;
  query: URLSearchParams;
  body: Record<string, unknown>;
}

const API_KEY = 'sk-contract-secret-key';
const MODEL = 'contract-model';

export function describeModelContract<P>(name: string, subject: ModelContractSubject<P>): void {
  describe(`${name} model contract`, () => {
    const seen: SeenRequest[] = [];
    const lookups: string[] = [];
    let status = 200;
    let server: ReturnType<typeof Bun.serve>;
    const originalLookup = outboundResolver.lookup;
    const originalConnectUrl = outboundResolver.connectUrl;

    beforeAll(() => {
      server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          const url = new URL(request.url);
          seen.push({
            method: request.method,
            path: url.pathname,
            contentType: request.headers.get('content-type'),
            headers: request.headers,
            query: url.searchParams,
            body: (await request.json().catch(() => ({}))) as Record<string, unknown>,
          });
          return status === 200
            ? Response.json(subject.okResponse)
            : new Response(`upstream failure for ${API_KEY}`, { status });
        },
      });
      outboundResolver.connectUrl = urlForAddress;
      outboundResolver.lookup = async (host: string) => {
        lookups.push(host);
        return ['127.0.0.1'];
      };
    });
    afterAll(() => {
      outboundResolver.lookup = originalLookup;
      outboundResolver.connectUrl = originalConnectUrl;
      server.stop(true);
    });
    afterEach(() => {
      seen.length = 0;
      lookups.length = 0;
      status = 200;
    });

    const instance = () =>
      subject.create({
        outbound: ALLOW_PRIVATE,
        apiKey: API_KEY,
        model: MODEL,
        baseUrl: `http://model.test:${server.port}`,
      });

    test('sends the request shape the vendor expects', async () => {
      await subject.invoke(instance());
      expect(seen).toHaveLength(1);
      expect(seen[0]?.method).toBe('POST');
      expect(seen[0]?.path).toBe(subject.path.replace('{model}', MODEL));
      expect(seen[0]?.contentType).toContain('application/json');
      if ('model' in (seen[0]?.body ?? {})) expect(seen[0]?.body.model).toBe(MODEL);
    });

    test('sends the key where the vendor reads it', async () => {
      await subject.invoke(instance());
      const { credential } = subject;
      if ('header' in credential) {
        expect(seen[0]?.headers.get(credential.header)).toBe(credential.value(API_KEY));
      } else {
        expect(seen[0]?.query.get(credential.query)).toBe(API_KEY);
      }
    });

    test('a non-2xx answer is an error that never names the key', async () => {
      status = 500;
      const error = await subject.invoke(instance()).then(
        () => null,
        (err: unknown) => err as Error
      );
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).not.toContain(API_KEY);
    });

    test('the request carries a timeout and fails when it fires', async () => {
      const timeouts: number[] = [];
      const spy = spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
        timeouts.push(ms);
        return AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError'));
      });
      try {
        await expect(subject.invoke(instance())).rejects.toBeInstanceOf(Error);
      } finally {
        spy.mockRestore();
      }
      expect(timeouts.length).toBeGreaterThan(0);
      expect(timeouts.every((ms) => ms > 0)).toBe(true);
    });

    test('the base URL goes through the pinned outbound resolver', async () => {
      await subject.invoke(instance());
      expect(lookups).toContain('model.test');
    });
  });
}
