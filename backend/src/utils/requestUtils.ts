import { FastifyRequest } from 'fastify';

/**
 * Thrown when a request is missing the required X-User-Id header.
 * Mapped to HTTP 400 by the global error handler in server.ts.
 */
export class MissingUserIdError extends Error {
  constructor() {
    super("Missing required header: X-User-Id");
    this.name = "MissingUserIdError";
  }
}

/**
 * Extracts and decodes the User ID from the request headers.
 * The frontend encodes the User ID to handle non-ASCII characters.
 *
 * Throws MissingUserIdError when the header is absent — callers must not fall
 * back to sentinel values like 'global': the id is used as a uuid database key
 * (users.id), and a sentinel leaks into SQL and fails with a confusing 500.
 */
export const getUserId = (req: FastifyRequest): string => {
    const rawUserId = req.headers['x-user-id'] as string | undefined;
    if (!rawUserId) {
        throw new MissingUserIdError();
    }
    try {
        // Decode URI component to handle Chinese characters etc.
        return decodeURIComponent(rawUserId);
    } catch {
        // Fallback to raw if decoding fails
        return rawUserId;
    }
};
