/**
 * Repository Layer - Public API
 *
 * Services should import repositories from this file only.
 *
 * Usage:
 *   import { createUserRepository, UserRepository } from '@/db/postgresql/repository/index.js';
 *
 *   const userRepo = createUserRepository(db);
 *   const profile = await userRepo.getProfileStatic(userId);
 */

export { BaseRepository } from './base.repository.js';
export { UserRepository, createUserRepository } from './user.repository.js';

// Re-export types for convenience
export type {
  ProfileStaticDatabase,
  ProfileDynamicDatabase
} from '../../../../../shared/dist/contracts/database/user-profile.schema.js';

export type {
  ProfileStatic,
  ProfileDynamic,
  HistorySummary
} from '../../../../../shared/dist/contracts/index.js';
