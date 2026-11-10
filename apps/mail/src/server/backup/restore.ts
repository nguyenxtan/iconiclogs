/** The adapter proves APPEND was never invoked, including after a raced timeout. */
export class DefiniteRestoreFailure extends Error {
  constructor() {
    super('BACKUP_RESTORE_NOT_STARTED');
    this.name = 'DefiniteRestoreFailure';
  }
}
