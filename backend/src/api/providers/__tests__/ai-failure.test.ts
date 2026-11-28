import { describe, expect, test } from 'bun:test';
import { type AppError, PayloadTooLargeError, ValidationError } from '../../../errors';
import { EndpointNotAllowedError } from '../../../utils/outbound-url';
import { aiFailure, loadAiProvider } from '../ai-failure';
import {
  ANTHROPIC_MAX_IMAGE_BYTES,
  anthropicMaxTokens,
  assertAnthropicImageSize,
} from '../domains/model/anthropic-limits';

describe('aiFailure', () => {
  test("the server's own address policy is passed on as a 400 with its message", () => {
    const failure = aiFailure(new EndpointNotAllowedError('Only public https:// addresses'), 'x');
    expect(failure).toBeInstanceOf(ValidationError);
    expect(failure.message).toBe('Only public https:// addresses');
  });

  test('an image too large for the provider keeps its own 413', () => {
    const tooBig = new PayloadTooLargeError('too big');
    expect(aiFailure(tooBig, 'x')).toBe(tooBig);
  });

  test('anything unrecognised falls back to the caller message', () => {
    const failure = aiFailure(new Error('socket hang up'), 'Could not be reached.');
    expect(failure.message).toBe('Could not be reached.');
    expect((failure as AppError).statusCode).toBe(502);
  });
});

describe('loadAiProvider', () => {
  test('a saved key that cannot be read asks for it again', async () => {
    const load = loadAiProvider(() => Promise.reject(new Error('Unknown encryption key id "k2"')));
    await expect(load).rejects.toThrow(
      "The saved AI key can't be read. Enter it again in Settings."
    );
  });

  test('an app error from loading is kept as is', async () => {
    const own = new ValidationError('No vision provider');
    await expect(loadAiProvider(() => Promise.reject(own))).rejects.toBe(own);
  });
});

describe('Anthropic limits', () => {
  test.each([
    ['claude-3-haiku-20240307', 4096],
    ['claude-3-opus-20240229', 4096],
    ['claude-3-5-sonnet-20241022', 8192],
    ['claude-3-7-sonnet-20250219', 8192],
    ['claude-sonnet-4-5', 16_000],
  ])('%s asks for at most %i output tokens', (model, cap) => {
    expect(anthropicMaxTokens(model)).toBe(cap);
  });

  test('an image over 5 MB is refused before it is sent', () => {
    expect(() => assertAnthropicImageSize(ANTHROPIC_MAX_IMAGE_BYTES)).not.toThrow();
    expect(() => assertAnthropicImageSize(ANTHROPIC_MAX_IMAGE_BYTES + 1)).toThrow(
      PayloadTooLargeError
    );
  });
});
