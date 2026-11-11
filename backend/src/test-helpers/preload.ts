// Runs before any test file is imported. Bun loads .env into process.env at startup, so without this a
// test that statically imports config or db/connection would open the developer's real database file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';
// Fixed key so provider credential decryption never throws in tests.
process.env.PROVIDER_ENCRYPTION_KEY ||= '0'.repeat(64);
