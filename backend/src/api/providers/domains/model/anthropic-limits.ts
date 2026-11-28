import { PayloadTooLargeError } from '../../../../errors';

export const ANTHROPIC_MAX_ENCODED_IMAGE_BYTES = 10_000_000;

export function anthropicMaxTokens(model: string): number {
  if (/^claude-3-[57]-/.test(model)) return 8192;
  if (/^claude-3-/.test(model)) return 4096;
  return 16_000;
}

export function assertAnthropicImageSize(bytes: number): void {
  if (Math.ceil(bytes / 3) * 4 > ANTHROPIC_MAX_ENCODED_IMAGE_BYTES) {
    throw new PayloadTooLargeError(
      'This receipt image is too large for the AI provider. Use a smaller photo.'
    );
  }
}
