// Bun loads .env before any test imports config, so the test environment is pinned here or a real database can be opened.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';
process.env.PROVIDER_ENCRYPTION_KEY ||= '0'.repeat(64);

const { outboundResolver } = await import('../utils/outbound-url');
outboundResolver.lookup = async () => ['93.184.215.14'];

export {};
