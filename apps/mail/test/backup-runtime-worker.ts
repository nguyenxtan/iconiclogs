// Synthetic fixtures only: this entry is never used by production Wrangler.
import { DurableObject } from 'cloudflare:workers';
import { BackupService } from '../src/server/backup/service';
import { BackupCoordinator, type BackupEnv } from '../src/server/backup/objects';
import { sha256 } from '../src/server/core/session';
import { backupKey, digest, open } from '../src/server/backup/crypto';
export { BackupCoordinator };
const credentials = {
  email: 'fixture@iconiclogs.com',
  password: 'synthetic-private-backup-password',
};
interface NativeEnv extends BackupEnv {
  FIXTURE: DurableObjectNamespace<NativeBackup>;
  BACKUPS: DurableObjectNamespace<BackupCoordinator>;
}
export class NativeBackup extends DurableObject<NativeEnv> {
  private createService() {
    return new BackupService(
      this.ctx.storage,
      this.env.BACKUP_BUCKET,
      this.env.BACKUP_KEY!,
      (identity) => ({
        quota: async () => ({ used: 80, limit: 100 }),
        snapshot: async () => [
          {
            path: 'INBOX',
            uidValidity: '17',
            upperUid: identity.email === 'large@iconiclogs.com' ? 1000 : 1,
          },
        ],
        batch: async () => {
          const message = (uid: number, raw: Uint8Array) => ({
            uid,
            raw,
            flags: ['\\Seen'],
            internalDate: '2026-01-01T00:00:00.000Z',
          });
          if (identity.email !== 'large@iconiclogs.com')
            return {
              cursor: 1,
              messages: [
                message(
                  1,
                  new TextEncoder().encode('Subject: native-private\r\n\r\nOriginal MIME'),
                ),
              ],
            };
          const random = (size: number) => {
            const bytes = new Uint8Array(size);
            for (let i = 0; i < bytes.length; i += 65536)
              crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65536, bytes.length)));
            return bytes;
          };
          const maximum = random(10 * 1024 * 1024),
            nearChunk = random(6 * 1024 * 1024 - 64 * 1024);
          const maximumSha = await digest(maximum),
            nearSha = await digest(nearChunk);
          const id = (uid: number, sha: string) =>
            digest(new TextEncoder().encode(JSON.stringify(['INBOX', '17', uid, sha])));
          // Snapshot rows sort by immutable item ID. Choose synthetic UIDs so the nearly-full
          // carry is durable before the exact MAX_MIME entry is assembled in the next step.
          let maximumUid = 500,
            maximumId = await id(maximumUid, maximumSha);
          while (maximumId < 'c' && maximumUid < 999)
            maximumId = await id(++maximumUid, maximumSha);
          let nearUid = 1,
            nearId = await id(nearUid, nearSha);
          while (nearId >= maximumId && nearUid < 499) nearId = await id(++nearUid, nearSha);
          if (nearId >= maximumId) throw Error('fixture could not order synthetic entries');
          return {
            cursor: 1000,
            messages: [message(nearUid, nearChunk), message(maximumUid, maximum)],
          };
        },
        append: async () => true,
      }),
    );
  }
  private service = this.createService();
  alarm() {
    return this.service.alarm();
  }
  async capture(large = false) {
    const identity = large ? { ...credentials, email: 'large@iconiclogs.com' } : credentials;
    await this.service.start(identity);
    let maximumCarry = 0;
    for (let i = 0; i < 100; i++) {
      const status = await this.createService().step(identity);
      if (large) {
        const objects = await this.env.BACKUP_BUCKET!.list({
          prefix: `${await sha256(identity.email)}/2026/01/`,
        });
        for (const object of objects.objects)
          if (object.key.includes('.carry-')) maximumCarry = Math.max(maximumCarry, object.size);
      }
      if (status.run?.state !== 'running') {
        if (large) {
          const items = await this.service.catalog(identity.email);
          for (const item of items) await this.createService().download(identity.email, item.id);
          return {
            ...status,
            nativeBoundary: { maximumCarry, sizes: items.map((item) => item.size) },
          };
        }
        return status;
      }
    }
    throw Error('native packaging did not finish');
  }
  async expiredResume() {
    const identity = { ...credentials, email: 'expired@iconiclogs.com' };
    const scope = await sha256(identity.email),
      key = await backupKey(this.env.BACKUP_KEY!);
    await this.service.start(identity);
    await this.service.step(identity);
    let job: { id: string; key: string; uploadId?: string; carry?: string } | undefined;
    for (let i = 0; i < 20; i++) {
      await this.createService().packMonthStep(identity.email, '2026-01');
      const bytes = await this.ctx.storage.get<Uint8Array>('month-job:2026-01');
      job = JSON.parse(
        new TextDecoder().decode(
          await open(new Uint8Array(bytes!), key, `${scope}:month-job:2026-01`),
        ),
      );
      if (job?.uploadId && job.carry) break;
    }
    if (!job?.uploadId || !job.carry) throw Error('fixture did not reach durable multipart carry');
    await this.env.BACKUP_BUCKET!.resumeMultipartUpload(job.key, job.uploadId).abort();
    let status = await this.createService().packMonthStep(identity.email, '2026-01');
    for (let i = 0; i < 20 && status.state !== 'error'; i++)
      status = await this.createService().packMonthStep(identity.email, '2026-01');
    const expiredFailure = status.state === 'error';
    for (let i = 0; i < 40 && status.state !== 'ready'; i++)
      status = await this.createService().packMonthStep(identity.email, '2026-01');
    const item = (await this.service.catalog(identity.email))[0]!;
    const intact = new TextDecoder()
      .decode((await this.service.download(identity.email, item.id)).content)
      .includes('Original MIME');
    return {
      expiredFailure,
      state: status.state,
      restarted: status.archive?.id !== job.id,
      intact,
    };
  }
  describeMonth(month: string) {
    return this.service.describeMonth(credentials.email, month);
  }
  downloadMonth(month: string) {
    return this.service.downloadMonth(credentials.email, month);
  }
  months() {
    return this.service.months(credentials.email);
  }
  catalog() {
    return this.service.catalog(credentials.email);
  }
  download(id: string) {
    return this.service.download(credentials.email, id);
  }
  restore(id: string, requestId: string) {
    return this.service.restore(credentials, id, 'INBOX', requestId);
  }
  configure(enabled: boolean) {
    return this.service.configure(credentials, enabled);
  }
  async privateAtRest() {
    const rows = await this.ctx.storage.list();
    const serialized = JSON.stringify([...rows]);
    return (
      !serialized.includes('synthetic-private-backup-password') &&
      !serialized.includes('INBOX') &&
      !serialized.includes('native-private')
    );
  }
}
export default {
  async fetch(request: Request, env: NativeEnv) {
    const action = new URL(request.url).pathname;
    const fixture = env.FIXTURE.getByName(await sha256(credentials.email));
    if (action === '/expired-resume')
      return Response.json(
        await env.FIXTURE.getByName(await sha256('expired@iconiclogs.com')).expiredResume(),
      );
    if (action === '/scope') {
      const coordinator = env.BACKUPS.getByName(await sha256(credentials.email));
      return Response.json(await coordinator.status('wrong@iconiclogs.com'));
    }
    if (action === '/revoked')
      return Response.json(
        await env.BACKUPS.getByName(await sha256(credentials.email)).configure(credentials, true),
      );
    if (action === '/large')
      return Response.json(
        await env.FIXTURE.getByName(await sha256('large@iconiclogs.com')).capture(true),
      );
    if (action === '/capture') return Response.json(await fixture.capture());
    if (action === '/monthly-head') return Response.json(await fixture.describeMonth('2026-01'));
    if (action === '/months') return Response.json(await fixture.months());
    if (action === '/monthly-download')
      return new Response((await fixture.downloadMonth('2026-01')).body);
    if (action === '/catalog') return Response.json(await fixture.catalog());
    if (action === '/enable') return Response.json(await fixture.configure(true));
    if (action === '/disable') return Response.json(await fixture.configure(false));
    if (action === '/private') return Response.json(await fixture.privateAtRest());
    const item = (await fixture.catalog())[0]!;
    if (action === '/download')
      return new Response(new Uint8Array((await fixture.download(item.id)).content).buffer);
    if (action === '/restore')
      return Response.json(await fixture.restore(item.id, 'native-restore'));
    if (action === '/tamper') {
      const objects = await env.BACKUP_BUCKET!.list();
      const scope = await sha256(credentials.email);
      await env.BACKUP_BUCKET!.put(
        objects.objects.find((object) => object.key.startsWith(scope))!.key,
        new Uint8Array([0, 1, 2]),
      );
      try {
        await fixture.download(item.id);
        return Response.json(false);
      } catch {
        return Response.json(true);
      }
    }
    return new Response('missing', { status: 404 });
  },
};
