import { v4 as uuidv4 } from 'uuid';

/**
 * Infrastructure Resilience Test: WebSocket Outbox Logic
 * Simulates network failures and verifies that the OutboxManager correctly
 * queues and retries messages.
 * 
 * Note: Mocking the storage layer for Node.js compatibility.
 */

// 1. Mock Database
class MockSyncQueue {
  private data: Map<string, any> = new Map();

  async add(entry: any) {
    this.data.set(entry.id, { ...entry });
  }

  async update(id: string, updates: any) {
    const entry = this.data.get(id);
    if (entry) {
      Object.assign(entry, updates);
    }
  }

  async toArray() {
    return Array.from(this.data.values());
  }

  where(field: string) {
    return {
      equals: (value: any) => ({
        toArray: async () => Array.from(this.data.values()).filter(item => item[field] === value)
      })
    };
  }
}

// 2. Simplified OutboxManager for testing
class TestOutboxManager {
  public isSyncing = false;
  private sender: ((type: string, payload: any) => boolean) | null = null;
  public db = new MockSyncQueue();

  setSender(sender: (type: string, payload: any) => boolean) {
    this.sender = sender;
  }

  async enqueue(type: string, payload: any) {
    const entry = {
      id: uuidv4(),
      type,
      payload,
      timestamp: new Date().toISOString(),
      attempts: 0,
      status: 'PENDING',
    };
    await this.db.add(entry);
    await this.triggerSync();
  }

  async triggerSync() {
    if (this.isSyncing || !this.sender) return;
    this.isSyncing = true;
    try {
      const pending = await (this.db as any).where('status').equals('PENDING').toArray();
      for (const entry of pending) {
        const success = this.sender(entry.type, entry.payload);
        if (success) {
          await this.db.update(entry.id, { status: 'SYNCED' });
        } else {
          const newAttempts = entry.attempts + 1;
          await this.db.update(entry.id, { 
            attempts: newAttempts,
            status: newAttempts >= 5 ? 'FAILED' : 'PENDING'
          });
          break; // Stop syncing on failure
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }
}

async function runResilienceTest() {
  console.log('--- [Resilience Test] WebSocket Outbox ---');
  const outbox = new TestOutboxManager();

  // Scenario 1: Successful send
  console.log('\n1. Testing successful send...');
  outbox.setSender(() => true);
  await outbox.enqueue('test_event', { data: 1 });
  const data1 = await outbox.db.toArray();
  console.log(`   Result: Status is ${data1[0].status} (Expected: SYNCED)`);

  // Scenario 2: Simulated network failure (sender returns false)
  console.log('\n2. Testing network failure (queueing)...');
  outbox.setSender(() => false);
  await outbox.enqueue('offline_event', { data: 2 });
  const data2 = await outbox.db.toArray();
  const offlineEntry = data2.find(e => e.payload.data === 2);
  console.log(`   Result: Status is ${offlineEntry?.status}, attempts: ${offlineEntry?.attempts} (Expected: PENDING, 1)`);

  // Scenario 3: Recovery
  console.log('\n3. Testing recovery (retry sync)...');
  outbox.setSender(() => true);
  await outbox.triggerSync();
  const data3 = await outbox.db.toArray();
  const recoveredEntry = data3.find(e => e.payload.data === 2);
  console.log(`   Result: Status is ${recoveredEntry?.status} (Expected: SYNCED)`);

  // Scenario 4: Max retries (failure)
  console.log('\n4. Testing max retries...');
  outbox.setSender(() => false);
  await outbox.enqueue('fail_event', { data: 3 });
  for (let i = 0; i < 6; i++) {
    await outbox.triggerSync();
  }
  const data4 = await outbox.db.toArray();
  const failedEntry = data4.find(e => e.payload.data === 3);
  console.log(`   Result: Status after 5+ attempts: ${failedEntry?.status} (Expected: FAILED)`);
}

runResilienceTest().catch(console.error);
