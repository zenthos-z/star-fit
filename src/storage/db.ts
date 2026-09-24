import Dexie, { type Table } from 'dexie';
import type { WorkoutSession, UserProfile, BiometricMetric, AgentInteraction } from '../types/protocol';

export class StarfitDatabase extends Dexie {
  // L2 Fact Storage
  workoutSessions!: Table<WorkoutSession>;
  userProfiles!: Table<UserProfile>;
  biometrics!: Table<BiometricMetric>;
  
  // L3 Fluid Storage (History)
  interactions!: Table<AgentInteraction>;
  
  // Sync Queue (Outbox)
  syncQueue!: Table<{
    id: string;
    type: string;
    payload: any;
    timestamp: string;
    attempts: number;
    status: 'PENDING' | 'FAILED' | 'SYNCED';
  }>;

  constructor() {
    super('StarfitV2');

    this.version(1).stores({
      workoutSessions: 'id, userId, status, startTime, version',
      userProfiles: 'userId, fitnessLevel, version',
      biometrics: '++id, type, timestamp',
      interactions: 'traceId, agentId, timestamp, role',
      syncQueue: 'id, type, timestamp, status'
    });

    // v2：户外运动活动轨迹（刷新/闪退恢复用，单条 'active' 记录）
    this.version(2).stores({
      activeTracks: 'key, updatedAt'
    });
  }
}

export const db = new StarfitDatabase();
