import { db } from '../../storage/db';
import { v4 as uuidv4 } from 'uuid';

/**
 * OutboxManager: Handles offline message queuing and reliable synchronization
 * Based on TECH_STANDARDS.md and DATA_PROTOCOL_STANDARD.md
 */
export class OutboxManager {
  private isSyncing = false;
  private sender: ((type: string, payload: any) => boolean) | null = null;

  public setSender(sender: (type: string, payload: any) => boolean) {
    this.sender = sender;
  }

  public async enqueue(type: string, payload: any) {
    const entry = {
      id: uuidv4(),
      type,
      payload,
      timestamp: new Date().toISOString(),
      attempts: 0,
      status: 'PENDING' as const,
    };

    await db.syncQueue.add(entry);
    this.triggerSync();
  }

  public async triggerSync() {
    if (this.isSyncing || !this.sender) return;
    this.isSyncing = true;

    try {
      const pending = await db.syncQueue
        .where('status')
        .equals('PENDING')
        .toArray();

      for (const entry of pending) {
        const success = this.sender(entry.type, entry.payload);
        if (success) {
          await db.syncQueue.update(entry.id, { status: 'SYNCED' });
        } else {
          const newAttempts = entry.attempts + 1;
          await db.syncQueue.update(entry.id, { 
            attempts: newAttempts,
            status: newAttempts >= 5 ? 'FAILED' : 'PENDING'
          });
          // If sender fails (e.g. socket closed), stop syncing the rest
          break;
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }
}

export const outboxManager = new OutboxManager();
