import { DurableObject } from 'cloudflare:workers';
import type { Credentials } from '../core/session';
import { BackupService } from './service';
import { ViettelBackupSource } from './viettel';
import { backupError } from './crypto';
import { captureRpc } from '../core/rpc';

export interface BackupEnv {
  BACKUP_BUCKET?: R2Bucket;
  BACKUP_KEY?: string;
  MAIL_HOST?: string;
  MAIL_ALLOWED_USERS?: string;
  SENT_MODE?: string;
  MAIL_SENT_FOLDER?: string;
}
export class BackupCoordinator extends DurableObject<BackupEnv> {
  private service: BackupService;
  constructor(ctx: DurableObjectState, env: BackupEnv) {
    super(ctx, env);
    this.service = new BackupService(
      ctx.storage,
      env.BACKUP_BUCKET,
      env.BACKUP_KEY || '',
      (credentials) => {
        const allowed = (env.MAIL_ALLOWED_USERS || '')
          .split(',')
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean);
        if (!allowed.includes(credentials.email.trim().toLowerCase()))
          throw backupError('BACKUP_REVOKED', 'Tài khoản không còn được phép sao lưu.', 403);
        if (!env.MAIL_HOST || !['append', 'provider'].includes(env.SENT_MODE || ''))
          throw backupError('BACKUP_UNAVAILABLE', 'Chưa cấu hình máy chủ sao lưu.', 503);
        return new ViettelBackupSource(credentials, {
          host: env.MAIL_HOST,
          sentMode: env.SENT_MODE as 'append' | 'provider',
          sentFolder: env.MAIL_SENT_FOLDER,
        });
      },
      ctx.id.name,
    );
  }
  status(email: string) {
    return captureRpc(() => this.service.status(email));
  }
  configure(credentials: Credentials, enabled: boolean) {
    return captureRpc(() => this.service.configure(credentials, enabled));
  }
  start(credentials: Credentials) {
    return captureRpc(() => this.service.start(credentials));
  }
  step(credentials: Credentials) {
    return captureRpc(() => this.service.step(credentials));
  }
  catalog(email: string, month?: string) {
    return captureRpc(() => this.service.catalog(email, month));
  }
  months(email: string) {
    return captureRpc(() => this.service.months(email));
  }
  packMonth(email: string, month: string) {
    return captureRpc(() => this.service.packMonth(email, month));
  }
  packMonthStep(email: string, month: string) {
    return captureRpc(() => this.service.packMonthStep(email, month));
  }
  describeMonth(email: string, month: string) {
    return captureRpc(() => this.service.describeMonth(email, month));
  }
  downloadMonth(email: string, month: string) {
    return captureRpc(() => this.service.downloadMonth(email, month));
  }
  download(email: string, id: string) {
    return captureRpc(() => this.service.download(email, id));
  }
  restore(credentials: Credentials, id: string, targetFolder: string, requestId: string) {
    return captureRpc(() => this.service.restore(credentials, id, targetFolder, requestId));
  }
  alarm() {
    return this.service.alarm();
  }
}
