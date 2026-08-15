import { FastifyRequest } from 'fastify';

/**
 * Extracts and decodes the User ID from the request headers.
 * The frontend encodes the User ID to handle non-ASCII characters.
 */
export const getUserId = (req: FastifyRequest): string => {
    const rawUserId = (req.headers['x-user-id'] as string) || 'global';
    try {
        // Decode URI component to handle Chinese characters etc.
        return decodeURIComponent(rawUserId);
    } catch (e) {
        // Fallback to raw if decoding fails
        return rawUserId;
    }
};
