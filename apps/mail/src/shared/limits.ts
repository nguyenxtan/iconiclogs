/** Binary attachment and encoded MIME bounds shared by the UI and Worker. */
export const MAX_MIME_BYTES = 25 * 1024 * 1024;
export const MAX_COMPOSE_BYTES = 18 * 1024 * 1024;
// Base64 attachment JSON plus bounded text, quote and envelope metadata.
export const MAX_REQUEST_BYTES = MAX_MIME_BYTES + 1024 * 1024;
