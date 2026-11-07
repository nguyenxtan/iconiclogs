import { MailError } from './errors';
export type RpcResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: string; status: number; message: string } };
export async function captureRpc<T>(operation: () => Promise<T>): Promise<RpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (!(error instanceof MailError)) throw error;
    return { ok: false, error: { code: error.code, status: error.status, message: error.message } };
  }
}
export function unwrapRpc<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new MailError(result.error.code, result.error.status, result.error.message);
  return result.value;
}
