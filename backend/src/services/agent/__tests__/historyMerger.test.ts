import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistorySources, normalizeSessionRow } from '../historyMerger.js';

describe('historyMerger', () => {
  it('returns live rows when summary is empty (the sync/push gap)', () => {
    const live = [
      {
        raw_json: {
          id: '8871b521-c246-4f00-823d-48618a9b68b8',
          startTime: '2026-09-08T01:35:26.881Z',
          endTime: '2026-09-08T01:40:15.078Z',
          exercises: [{ name: '箭步蹲' }, { name: '平板支撑' }],
        },
      },
    ];
    const merged = mergeHistorySources(undefined, live, 10);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].session_id, '8871b521-c246-4f00-823d-48618a9b68b8');
  });

  it('dedupes summary entries already covered by a live row', () => {
    const id = 'same-session-id';
    const summarySessions = [
      { session_id: id, start_time: '2026-09-07T10:00:00Z', exercises: [{ name: 'old' }] },
      { session_id: 'summary-only', start_time: '2026-09-01T10:00:00Z' },
    ];
    const live = [
      {
        raw_json: {
          id,
          startTime: '2026-09-07T10:00:00Z',
          exercises: [{ name: 'fresh from sessions table' }],
        },
      },
    ];
    const merged = mergeHistorySources(summarySessions, live, 10);
    assert.deepEqual(
      merged.map((m) => m.session_id),
      [id, 'summary-only'],
    );
    const fresh = merged.find((m) => m.session_id === id);
    assert.equal((fresh!.exercises as Array<{ name: string }>)[0].name, 'fresh from sessions table');
  });

  it('sorts newest-first and caps at limit', () => {
    const live = [1, 2, 3].map((i) => ({
      raw_json: { id: `s${i}`, startTime: `2026-09-0${i}T08:00:00Z` },
    }));
    const merged = mergeHistorySources(undefined, live, 2);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].session_id, 's3');
    assert.equal(merged[1].session_id, 's2');
  });

  it('normalizeSessionRow tolerates garbage and missing ids', () => {
    assert.equal(normalizeSessionRow('not-an-object'), null);
    assert.equal(normalizeSessionRow({ startTime: '2026-09-08' }), null); // no id
    const ok = normalizeSessionRow({ session_id: 'x', startTime: 1700000000000 });
    assert.equal(ok?.session_id, 'x');
    assert.ok(typeof ok?.start_time === 'string');
  });
});
