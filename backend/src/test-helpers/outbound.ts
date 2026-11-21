import { afterAll, beforeAll } from 'bun:test';
import { CONFIG } from '../config';

export function blockPrivateProviderEndpoints(): void {
  const config = CONFIG as { blockPrivateProviderEndpoints: boolean };
  const previous = config.blockPrivateProviderEndpoints;
  beforeAll(() => {
    config.blockPrivateProviderEndpoints = true;
  });
  afterAll(() => {
    config.blockPrivateProviderEndpoints = previous;
  });
}
