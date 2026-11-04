import { expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

it('persists encrypted draft chunks, revisions and send guards atomically in native SQLite DO storage', async () => {
  const root = resolve('apps/mail');
  const temporary = mkdtempSync(join(tmpdir(), 'iconic-personal-native-'));
  let runtime: Miniflare | undefined;
  try {
    const worker = join(temporary, 'personal-native-worker.ts');
    writeFileSync(
      worker,
      `
import { PersonalState as ProductionPersonalState } from ${JSON.stringify(join(root, 'src/server/storage/personal-object.ts'))};
import { PersonalData } from ${JSON.stringify(join(root, 'src/server/storage/personal.ts'))};
import { sha256 } from ${JSON.stringify(join(root, 'src/server/core/session.ts'))};
const email = 'fixture@iconiclogs.com';
const id = '12345678-1234-4123-a123-123456789012';
export class PersonalState extends ProductionPersonalState {
  async inspect() {
    const rows = await this.ctx.storage.list();
    const chunks = [...rows.entries()].filter(([key]) => key.startsWith('draft:'));
    return { chunks: chunks.length, sizes: chunks.map(([,value]) => value.byteLength),
      privateAtRest: [...rows.values()].every(value => !(value instanceof Uint8Array) || !new TextDecoder().decode(value).includes('Native private body')) };
  }
  async rollbackPartialWrite() {
    try {
      await this.ctx.storage.transaction(async txn => {
        let writes = 0;
        const storage = {
          get: key => txn.get(key), delete: key => txn.delete(key),
          put: async (key, value) => { if (++writes === 2) throw Error('synthetic storage failure'); return txn.put(key,value); },
        };
        const data = new PersonalData(storage, this.env.SESSION_KEY, email);
        await data.saveDraft(id, { to:['unfinished@'],cc:[],subject:'rollback',text:'must roll back',attachments:[{name:'failure.txt',type:'text/plain',content:'YWFh'.repeat(70000)}]}, 2);
      });
      return false;
    } catch { return true; }
  }
  async duplicateOpen() {
    return (await new PersonalData(this.ctx.storage,this.env.SESSION_KEY,email).draft(id)).revision;
  }
}
export default {
  async fetch(request, env) {
    const vault = env.PERSONAL.getByName(await sha256(email));
    if (new URL(request.url).pathname === '/wrong-first') {
      const other = env.PERSONAL.getByName(await sha256('fresh@iconiclogs.com'));
      return Response.json(await other.savePreferences(email, {displayName:'Wrong',signature:'',contacts:[]}));
    }
    const prefs = {displayName:'Native fixture',signature:'Native private signature',contacts:[]};
    const preferenceResult = await vault.savePreferences(email,prefs);
    if (!preferenceResult.ok) throw Error('valid preferences save rejected');
    const file = {name:'manifest.txt',type:'text/plain',content:'YWFh'.repeat(70000)};
    const draft = {to:['unfinished@'],cc:[],subject:'Private subject',text:'Native private body',attachments:[file],deliveryGuard:'unknown',deliveryKey:'native-delivery-key-123'};
    const saved = await vault.saveDraft(email,id,draft,0).catch(error => { throw Error('initial 280KiB save: '+error.message); });
    if (!saved.ok) throw Error('first draft save failed');
    const latest = await vault.saveDraft(email,id,{...draft,text:'Native private body latest'},1);
    if (!latest.ok) throw Error('second draft save failed');
    const stale = await vault.saveDraft(email,id,{...draft,text:'stale'},1);
    const staleDelete = await vault.removeDraft(email,id,1);
    const rollback = await vault.rollbackPartialWrite();
    const opened = await vault.draft(email,id);
    if (!opened.ok) throw Error('latest draft missing after rollback');
    let crossReadRejected = false;
    try { const wrong = await vault.draft('other@iconiclogs.com',id); crossReadRejected = !wrong.ok; } catch { crossReadRejected = true; }
    const wrongWrite = await vault.savePreferences('other@iconiclogs.com',{displayName:'overwrite',signature:'wrong',contacts:[]});
    let originalPrefsIntact = false;
    try { const read = await vault.preferences(email); originalPrefsIntact = read.ok && read.value.signature === prefs.signature; } catch {}
    const wrongDraft = await vault.saveDraft('other@iconiclogs.com',id,draft,0).catch(() => ({ok:false}));
    const inspection = await vault.inspect();
    const duplicateOpen = await vault.duplicateOpen();
    // A larger attachment verifies many writes in the real transaction rather than only two chunks.
    const largeId = '22345678-1234-4123-a123-123456789012';
    const large = {...draft,attachments:[{...file,content:'YWFh'.repeat(1500000)}]};
    const largeSaved = await vault.saveDraft(email,largeId,large,0).catch(error => { throw Error('6MB save: '+error.message); });
    const largeOpened = await vault.draft(email,largeId);
    return Response.json({
      inspection, duplicateOpen, rollback, stale, staleDelete, crossReadRejected,
      crossWriteRejected: !wrongWrite.ok, crossDraftRejected: !wrongDraft.ok, originalPrefsIntact,
      latestPreserved: opened.value.revision === 2 && opened.value.draft.text === 'Native private body latest',
      fullFilePreserved: opened.value.draft.attachments[0].content === file.content,
      guardPreserved: opened.value.draft.deliveryGuard === 'unknown' && opened.value.draft.deliveryKey === 'native-delivery-key-123',
      largePreserved: largeSaved.ok && largeOpened.ok && largeOpened.value.draft.attachments[0].content === large.attachments[0].content,
    });
  },
};
`,
    );
    const config = join(temporary, 'wrangler.json');
    writeFileSync(
      config,
      JSON.stringify({
        name: 'personal-native-test',
        main: worker,
        compatibility_date: '2026-11-01',
        compatibility_flags: ['nodejs_compat'],
        durable_objects: { bindings: [{ name: 'PERSONAL', class_name: 'PersonalState' }] },
        migrations: [{ tag: 'v1', new_sqlite_classes: ['PersonalState'] }],
      }),
    );
    execFileSync(
      join(root, 'node_modules/.bin/wrangler'),
      ['deploy', '--dry-run', '--config', config, '--outdir', join(temporary, 'bundle')],
      { stdio: 'pipe', timeout: 30000 },
    );
    runtime = new Miniflare({
      telemetry: { enabled: false },
      workers: [
        {
          config: {
            name: 'personal-native-test',
            compatibilityDate: '2026-11-01',
            compatibilityFlags: ['nodejs_compat'],
            manifest: {
              mainModule: 'personal-native-worker.js',
              modules: {
                'personal-native-worker.js': {
                  type: 'esm',
                  contents: readFileSync(
                    join(temporary, 'bundle/personal-native-worker.js'),
                    'utf8',
                  ),
                },
              },
            },
            env: {
              SESSION_KEY: { type: 'text', value: Buffer.alloc(32, 23).toString('base64') },
              PERSONAL: {
                type: 'durable-object',
                worker: 'personal-native-test',
                exportName: 'PersonalState',
              },
            },
            exports: { PersonalState: { type: 'durable-object', storage: 'sqlite' } },
          },
          dev: { rootPath: temporary },
        },
      ],
    });
    const first = await runtime.dispatchFetch('http://test.local/wrong-first');
    expect(first.status, await first.clone().text()).toBe(200);
    const wrongFirst = (await first.json()) as { ok: boolean };
    expect(wrongFirst.ok, 'DO name must reject the first wrong mailbox write').toBe(false);
    const response = await runtime.dispatchFetch('http://test.local/exercise');
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as any;
    expect(result.inspection.chunks).toBeGreaterThan(1);
    expect(result.inspection.sizes.every((size: number) => size <= 120000)).toBe(true);
    expect(result.inspection.privateAtRest).toBe(true);
    expect(result.stale).toMatchObject({ ok: false, error: { code: 'DRAFT_CONFLICT' } });
    expect(result.staleDelete).toMatchObject({ ok: false, error: { code: 'DRAFT_CONFLICT' } });
    expect(result.duplicateOpen).toBe(2);
    for (const check of [
      'rollback',
      'latestPreserved',
      'fullFilePreserved',
      'guardPreserved',
      'largePreserved',
      'crossReadRejected',
      'crossWriteRejected',
      'crossDraftRejected',
      'originalPrefsIntact',
    ])
      expect(result[check], check).toBe(true);
  } finally {
    await runtime?.dispose();
    rmSync(temporary, { recursive: true, force: true });
  }
}, 60000);
