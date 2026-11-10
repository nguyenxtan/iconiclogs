import { afterEach, expect, it, vi } from 'vitest';
import { liveApi } from '../src/ui/api';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

for (const operation of ['save', 'send', 'open'] as const) {
  it(`allows a slow large draft ${operation} to finish beyond ninety seconds without retrying`, async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    let finish!: () => void;
    let signal!: AbortSignal;
    const fetcher = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Promise<Response>((resolve, reject) => {
        finish = () => resolve(Response.json({ status: 'sent' }));
        signal.addEventListener('abort', () => reject(new Error('upload timed out')));
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const draft = {
      to: ['test@example.test'],
      cc: [],
      subject: 'Tệp thử nghiệm',
      text: 'Nội dung tiếng Việt',
      attachments: [],
    };
    const work =
      operation === 'save'
        ? liveApi.saveDraft('id', draft, 0, 'csrf')
        : operation === 'open'
          ? liveApi.draft('id')
          : liveApi.send(draft, 'csrf', 'stable-send-key');
    const settled = work.then(
      () => 'done',
      () => 'failed',
    );
    await vi.advanceTimersByTimeAsync(95_000);
    expect(signal.aborted).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish();
    expect(await settled).toBe('done');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
}
