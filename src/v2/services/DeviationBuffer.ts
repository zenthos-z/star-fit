export interface DeviationRecord {
  exerciseId: string;
  exerciseName: string;
  exerciseIndex: number;
  setIndex: number | null;
  field: 'weight' | 'reps' | 'targetRpe';
  original: number;
  current: number;
  reason?: string;
  timestamp: string;
}

class DeviationBuffer {
  private records: DeviationRecord[] = [];

  addDeviation(
    exerciseId: string,
    exerciseName: string,
    exerciseIndex: number,
    setIndex: number | null,
    field: 'weight' | 'reps' | 'targetRpe',
    original: number,
    current: number
  ): number {
    const record: DeviationRecord = {
      exerciseId,
      exerciseName,
      exerciseIndex,
      setIndex,
      field,
      original,
      current,
      timestamp: new Date().toISOString()
    };
    this.records.push(record);
    return this.records.length - 1;
  }

  updateReason(index: number, reason: string): void {
    if (this.records[index]) {
      this.records[index].reason = reason;
    }
  }

  getRecords(): DeviationRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records = [];
  }
}

export const deviationBuffer = new DeviationBuffer();
