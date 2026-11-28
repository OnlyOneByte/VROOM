import { AppError, PayloadTooLargeError, ValidationError } from '../../errors';
import { EndpointNotAllowedError } from '../../utils/outbound-url';
import { healthCodeOf } from './provider-status';

export function aiFailure(error: unknown, unreachableMessage: string): AppError {
  if (error instanceof EndpointNotAllowedError) return new ValidationError(error.message);
  if (error instanceof PayloadTooLargeError) return error;
  const message = error instanceof Error ? error.message : '';
  if (/HTTP 429\b/.test(message)) {
    return new AppError(
      'The AI provider is limiting requests right now. Try again in a few minutes.',
      503
    );
  }
  switch (healthCodeOf(error)) {
    case 'auth':
    case 'permission':
      return new AppError(
        "The AI provider didn't accept its key. Check it in Settings, then try again.",
        502
      );
    case 'config':
      return new AppError(
        "The AI provider didn't accept the request. Check the model name in Settings.",
        502
      );
    default:
      return new AppError(unreachableMessage, 502);
  }
}

export async function loadAiProvider<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("The saved AI key can't be read. Enter it again in Settings.", 502);
  }
}
