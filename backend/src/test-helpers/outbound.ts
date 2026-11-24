import { afterAll, beforeAll } from 'bun:test';
import { CONFIG } from '../config';

type PrivateEndpointSettings = { block: boolean; allow: string };

export function usePrivateProviderEndpoints(settings: PrivateEndpointSettings): void {
  const config = CONFIG as { privateProviderEndpoints: PrivateEndpointSettings };
  const previous = config.privateProviderEndpoints;
  beforeAll(() => {
    config.privateProviderEndpoints = settings;
  });
  afterAll(() => {
    config.privateProviderEndpoints = previous;
  });
}

export function blockPrivateProviderEndpoints(): void {
  usePrivateProviderEndpoints({ block: false, allow: '' });
}
