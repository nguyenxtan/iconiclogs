// Synthetic fixtures only: this entry is never used by production Wrangler.
import { DurableObject } from 'cloudflare:workers';
import { BackupService } from '../src/server/backup/service';
import { BackupCoordinator, type BackupEnv } from '../src/server/backup/objects';
import { sha256 } from '../src/server/core/session';
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
  private service = new BackupService(
    this.ctx.storage,
    this.env.BACKUP_BUCKET,
    this.env.BACKUP_KEY!,
    (identity) => ({
      snapshot: async () => [{ path: 'INBOX', uidValidity: '17', upperUid: 1 }],
      batch: async () => ({
        cursor: 1,
        messages: [
          {
            uid: 1,
            raw:
              identity.email === 'large@iconiclogs.com'
                ? new Uint8Array(10 * 1024 * 1024)
                : new TextEncoder().encode('Subject: native-private\r\n\r\nOriginal MIME'),
            flags: ['\\Seen'],
            internalDate: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      append: async () => true,
    }),
  );
  alarm() {
    return this.service.alarm();
  }
  async capture(large = false) {
    const identity = large ? { ...credentials, email: 'large@iconiclogs.com' } : credentials;
    await this.service.start(identity);
    return this.service.step(identity);
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
    if (action === '/catalog') return Response.json(await fixture.catalog());
    if (action === '/enable') return Response.json(await fixture.configure(true));
    if (action === '/disable') return Response.json(await fixture.configure(false));
    if (action === '/private') return Response.json(await fixture.privateAtRest());
    const item = (await fixture.catalog())[0]!;
    if (action === '/download') return new Response((await fixture.download(item.id)).content);
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
