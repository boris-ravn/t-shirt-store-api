export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// A generous ceiling enforced by multer's own streaming limit, well above
// MAX_IMAGE_BYTES — a resource-exhaustion backstop, not the real validation.
// The real 5 MiB check runs in ProductImagesService against the fully
// buffered file, where the exact receivedBytes is actually known; Nest's
// multer integration converts a *streaming* limit violation into a bare
// PayloadTooLargeException with no byte counts at all (verified against
// @nestjs/platform-express's own transformException source), so relying on
// multer's limit alone can't produce the contract's maxBytes/receivedBytes.
export const MULTER_HARD_CEILING_BYTES = 20 * 1024 * 1024;

export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const EXTENSION_BY_MIME_TYPE: Record<
  (typeof ACCEPTED_IMAGE_MIME_TYPES)[number],
  string
> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function extensionForMimeType(mimeType: string): string {
  return (
    EXTENSION_BY_MIME_TYPE[
      mimeType as (typeof ACCEPTED_IMAGE_MIME_TYPES)[number]
    ] ?? 'bin'
  );
}
