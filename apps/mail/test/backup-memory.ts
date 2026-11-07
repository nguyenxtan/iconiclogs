import type { Credentials } from '../src/server/core/session';
import type { BackupStatus } from '../src/shared/backup';
import type { ArchiveBucket } from '../src/server/backup/monthly';
export class MemoryBucket implements ArchiveBucket {
  blobs = new Map<string, Uint8Array>();
  uploads = new Map<string, { key: string; parts: Map<number, Uint8Array> }>();
  fault?: 'upload' | 'complete';
  async put(key: string, bytes: Uint8Array) {
    this.blobs.set(key, bytes.slice());
  }
  async get(key: string, options?: { range: { offset: number; length: number } }) {
    const value = this.blobs.get(key);
    if (!value) return null;
    const bytes = options
      ? value.slice(options.range.offset, options.range.offset + options.range.length)
      : value.slice();
    return { arrayBuffer: async () => bytes.buffer };
  }
  async head(key: string) {
    const value = this.blobs.get(key);
    return value ? { size: value.length } : null;
  }
  async delete(key: string) {
    this.blobs.delete(key);
  }
  async createMultipartUpload(key: string) {
    const uploadId = crypto.randomUUID();
    this.uploads.set(uploadId, { key, parts: new Map() });
    return { uploadId };
  }
  resumeMultipartUpload(key: string, uploadId: string) {
    const self = this;
    return {
      async uploadPart(partNumber: number, value: Uint8Array) {
        const upload = self.uploads.get(uploadId);
        if (!upload || upload.key !== key)
          throw Error('uploadPart: The specified multipart upload does not exist. (10024)');
        upload.parts.set(partNumber, value.slice());
        if (self.fault === 'upload') {
          self.fault = undefined;
          throw Error('lost upload response');
        }
        return { partNumber, etag: String(partNumber) };
      },
      async complete(parts: { partNumber: number; etag: string }[]) {
        const upload = self.uploads.get(uploadId);
        if (!upload)
          throw Error('complete: The specified multipart upload does not exist. (10024)');
        const values = parts.map((part) => upload.parts.get(part.partNumber)!);
        if (
          values.some(
            (value, i) =>
              i < values.length - 1 &&
              (value.length < 5 * 1024 * 1024 || value.length !== values[0]!.length),
          )
        )
          throw Error('invalid multipart sizes');
        const combined = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0));
        let offset = 0;
        for (const value of values) {
          combined.set(value, offset);
          offset += value.length;
        }
        self.blobs.set(key, combined);
        self.uploads.delete(uploadId);
        if (self.fault === 'complete') {
          self.fault = undefined;
          throw Error('lost complete response');
        }
      },
    };
  }
}
export async function finishCapture(
  service: { step(credentials: Credentials): Promise<BackupStatus> },
  credentials: Credentials,
): Promise<BackupStatus> {
  for (let i = 0; i < 1000; i++) {
    const result = await service.step(credentials);
    if (result.run?.state !== 'running') return result;
  }
  throw Error('capture did not finish');
}
