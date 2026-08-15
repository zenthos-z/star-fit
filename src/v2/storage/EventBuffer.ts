/**
 * EventBuffer: Manages high-frequency data flow and worker communication
 */

export class EventBuffer {
  private worker: Worker;
  private buffer: any[] = [];
  private readonly MAX_BUFFER_SIZE = 100;

  constructor() {
    // Note: In Vite, we use ?worker for worker files
    this.worker = new Worker(new URL('./workers/processor.worker.ts', import.meta.url), {
      type: 'module'
    });

    this.worker.onmessage = (event) => {
      this.handleWorkerMessage(event.data);
    };
  }

  public push(event: any) {
    this.buffer.push(event);
    
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      this.flush();
    }
  }

  private flush() {
    if (this.buffer.length === 0) return;
    
    this.worker.postMessage({
      type: 'BATCH_EVENTS',
      data: [...this.buffer]
    });
    
    this.buffer = [];
  }

  private handleWorkerMessage(message: any) {
    const { type, data } = message;
    
    if (type === 'EVENTS_BATCHED') {
      // Logic to save to L2 (IndexedDB) via db.ts
      console.log(`[EventBuffer] Batched events ready for L2 storage:`, data);
    }
  }

  public processSensorData(sensorData: any) {
    this.worker.postMessage({
      type: 'PROCESS_SENSOR_DATA',
      data: sensorData
    });
  }
}

export const eventBuffer = new EventBuffer();
