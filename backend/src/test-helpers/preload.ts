// Bun loads .env before any test imports config, so the test environment is pinned here or a real database can be opened.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';
process.env.PROVIDER_ENCRYPTION_KEY ||= '0'.repeat(64);
process.env.PRIVATE_PROVIDER_ENDPOINTS = 'allow';

const guard = await import('./transaction-guard');
guard.guardFetch();

const { outboundResolver } = await import('../utils/outbound-url');
outboundResolver.lookup = async () => {
  guard.refuseInsideTransaction('An outbound DNS lookup');
  return ['93.184.215.14'];
};
outboundResolver.connectUrl = (url) => url;

const { afterEach, beforeEach, expect } = await import('bun:test');
const { setLocalOcrForTest } = await import('../api/providers/domains/vlm/local-ocr');
const { fakeOcrWorker } = await import('./fake-ocr');
beforeEach(() => setLocalOcrForTest({ createWorker: fakeOcrWorker }));
afterEach(() => expect(guard.takeTransactionViolations()).toEqual([]));

export {};
