import { describe, expect, test } from 'bun:test';
import { PayloadTooLargeError } from '../../../errors';
import { readWithinSize } from '../domains/storage/storage-provider';

function countingStream(chunks: number, chunkSize: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled === chunks) return controller.close();
      state.pulled++;
      controller.enqueue(new Uint8Array(chunkSize));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe('readWithinSize', () => {
  test('a declared size over the limit is refused before any byte is read', async () => {
    const { stream, state } = countingStream(10, 100);
    let stopped = false;
    const read = readWithinSize(stream, 1000, { maxBytes: 500 }, () => {
      stopped = true;
    });

    await expect(read).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(state.pulled).toBeLessThanOrEqual(1);
    expect(stopped).toBe(true);
  });

  test('with no declared size, reading stops at the chunk that passes the limit', async () => {
    const { stream, state } = countingStream(1000, 100);
    const read = readWithinSize(stream, undefined, { maxBytes: 250 }, () => {});

    await expect(read).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(state.pulled).toBeLessThan(10);
    expect(state.cancelled).toBe(true);
  });

  test('a body within the limit comes back whole', async () => {
    const { stream } = countingStream(3, 100);
    const bytes = await readWithinSize(stream, 300, { maxBytes: 300 }, () => {});
    expect(bytes.length).toBe(300);
  });
});
