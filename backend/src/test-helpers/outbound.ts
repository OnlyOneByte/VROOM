import { afterAll, beforeAll } from 'bun:test';
import { CONFIG } from '../config';

export function allowPrivateProviderEndpoints(): void {
  const config = CONFIG as { allowPrivateProviderEndpoints: boolean };
  beforeAll(() => {
    config.allowPrivateProviderEndpoints = true;
  });
  afterAll(() => {
    config.allowPrivateProviderEndpoints = false;
  });
}
