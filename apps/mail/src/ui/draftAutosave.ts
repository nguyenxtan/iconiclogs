import type { SavedDraft, SendDraft } from '../shared/contracts';
export type DraftSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** A single write queue owns the revision. Changes made during a request are saved next. */
export class DraftAutosave {
  saved: SavedDraft | undefined;
  private desired: { draft: SendDraft; fingerprint: string } | undefined;
  private confirmed: string | undefined;
  private running: Promise<SavedDraft | undefined> | undefined;
  constructor(
    private readonly id: string,
    saved: SavedDraft | undefined,
    private readonly save: (id: string, value: SendDraft, revision: number) => Promise<SavedDraft>,
    private readonly status?: (status: DraftSaveStatus, error?: unknown) => void,
  ) {
    this.saved = saved;
    this.confirmed = saved ? JSON.stringify(saved.draft) : undefined;
  }
  get pending(): boolean {
    return !!this.desired && this.desired.fingerprint !== this.confirmed;
  }
  update(draft: SendDraft): void {
    const fingerprint = JSON.stringify(draft);
    this.desired = { draft, fingerprint };
    this.status?.(this.pending ? 'pending' : this.saved ? 'saved' : 'idle');
  }
  flush(): Promise<SavedDraft | undefined> {
    if (this.running) return this.running;
    // run() starts the first request synchronously; subsequent callers share this queue.
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async run(): Promise<SavedDraft | undefined> {
    try {
      while (this.pending && this.desired) {
        const next = this.desired;
        const revision = this.saved?.revision ?? 0;
        this.status?.('saving');
        const result = await this.save(this.id, next.draft, revision);
        if (result.id !== this.id || result.revision <= revision)
          throw Error('Máy chủ chưa xác nhận phiên bản bản nháp mới.');
        this.saved = result;
        this.confirmed = next.fingerprint;
      }
      this.status?.(this.saved ? 'saved' : 'idle');
      return this.saved;
    } catch (error) {
      // Never assume a lost response advanced our revision, or overwrite a conflicting draft.
      this.status?.('error', error);
      throw error;
    }
  }
}
