import { PayloadTooLargeError } from '../../../../errors';

export const ANTHROPIC_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function anthropicMaxTokens(model: string): number {
  if (/^claude-3-[57]-/.test(model)) return 8192;
  if (/^claude-3-/.test(model)) return 4096;
  return 16_000;
}

export function assertAnthropicImageSize(bytes: number): void {
  if (bytes > ANTHROPIC_MAX_IMAGE_BYTES) {
    throw new PayloadTooLargeError(
      "This receipt image is over the AI provider's 5 MB limit. Use a smaller photo."
    );
  }
}
