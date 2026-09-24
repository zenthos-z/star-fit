/**
 * BatchOps Service
 * Implements the JSON Patch (RFC 6902) protocol for atomic state updates.
 * Used for synchronizing changes between UI and L1-L3 storage.
 */

export interface PatchOp {
  op: 'replace' | 'add' | 'remove';
  path: string;
  value?: any;
}

export interface BatchRequest {
  method: 'architect.applyBatchOps';
  params: {
    ops: PatchOp[];
    preconditions: {
      version: number;
      state: string;
    };
    atomic_group_id?: string;
  };
}

export const BatchOps = {
  /**
   * Generates a batch request from a list of operations.
   */
  createRequest(ops: PatchOp[], version: number, state: string): BatchRequest {
    return {
      method: 'architect.applyBatchOps',
      params: {
        ops,
        preconditions: {
          version,
          state
        },
        atomic_group_id: `grp_${Date.now()}`
      }
    };
  },

  /**
   * Helper to create a 'replace' operation for a specific set field.
   */
  replaceSetField(exerciseIndex: number, setIndex: number, field: string, value: any): PatchOp {
    return {
      op: 'replace',
      path: `/workout/exercises/${exerciseIndex}/sets/${setIndex}/${field}`,
      value
    };
  }
};
