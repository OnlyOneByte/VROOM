import { afterAll, beforeAll } from 'bun:test';
import { CONFIG } from '../config';

export function allowPrivateProviderEndpoints(): void {
  const config = CONFIG as { allowPrivateProviderEndpoints: boolean };
  const previous = config.allowPrivateProviderEndpoints;
  beforeAll(() => {
    config.allowPrivateProviderEndpoints = true;
  });
  afterAll(() => {
    config.allowPrivateProviderEndpoints = previous;
  });
}
