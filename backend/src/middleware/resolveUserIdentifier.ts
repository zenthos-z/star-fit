/**
 * Resolve User Identifier Middleware
 *
 * Automatically resolves userId route parameters to UUIDs.
 * This allows API endpoints to accept both UUIDs and usernames in :userId params.
 *
 * Usage:
 *   server.addHook('onRequest', resolveUserIdentifierMiddleware);
 *
 * In route handlers, access the resolved UUID via:
 *   (req.params as any).resolvedUserId
 *
 * @module middleware/resolveUserIdentifier
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { resolveUserId } from '../db/postgresql/client/postgres-client.js';

export async function resolveUserIdentifierMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const userIdParam = (req.params as any)?.userId;

  if (!userIdParam) {
    return; // No userId parameter, skip processing
  }

  try {
    const resolvedUUID = await resolveUserId(userIdParam);
    (req.params as any).resolvedUserId = resolvedUUID;
  } catch (e) {
    return reply.status(404).send({ error: `User not found: ${userIdParam}` });
  }
}
