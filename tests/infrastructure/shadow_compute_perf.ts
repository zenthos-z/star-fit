/**
 * Infrastructure Performance Test: Shadow Computation
 * Benchmarks the algorithms used in the Web Worker for high-frequency data.
 * Based on TECH_STANDARDS.md Section 1.1
 */

// --- Replicated Worker Logic for Benchmarking ---

const STATE = {
  hrHistory: [] as { value: number; timestamp: number }[],
  maxHistorySize: 100,
};

function processSensorData(data: any) {
  const { type, value, metadata, timestamp } = data;
  const ts = timestamp ? new Date(timestamp).getTime() : Date.now();
  
  if (type === 'HR') {
    const age = metadata?.age || 30;
    const maxHR = 208 - 0.7 * age;
    const intensity = (value / maxHR) * 100;
    
    STATE.hrHistory.push({ value, timestamp: ts });
    if (STATE.hrHistory.length > STATE.maxHistorySize) {
      STATE.hrHistory.shift();
    }

    const features = extractHRFeatures(STATE.hrHistory, maxHR);
    
    return {
      ...data,
      processed: {
        maxHR,
        intensity: Math.round(intensity * 10) / 10,
        zone: getHRZone(intensity),
        features
      },
      processedAt: new Date().toISOString()
    };
  }
  return data;
}

function extractHRFeatures(history: { value: number; timestamp: number }[], maxHR: number) {
  if (history.length < 2) return null;
  const values = history.map(h => h.value);
  const latest = values[values.length - 1];
  const previous = values[values.length - 2];

  let sumSqDiff = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = 60000 / values[i] - 60000 / values[i - 1];
    sumSqDiff += diff * diff;
  }
  const hrvProxy = Math.sqrt(sumSqDiff / (values.length - 1));

  const windowSize = Math.min(10, values.length);
  const window = values.slice(-windowSize);
  const slope = (window[window.length - 1] - window[0]) / windowSize;

  const peakInWindow = Math.max(...values);
  const isRecovering = peakInWindow > maxHR * 0.8 && latest < previous;

  return {
    hrvProxy: Math.round(hrvProxy * 100) / 100,
    slope: Math.round(slope * 100) / 100,
    trend: slope > 0.5 ? 'rising' : slope < -0.5 ? 'falling' : 'stable',
    isRecovering,
    windowStats: {
      min: Math.min(...values),
      max: peakInWindow,
      avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    }
  };
}

function getHRZone(intensity: number): number {
  if (intensity < 50) return 0;
  if (intensity < 60) return 1;
  if (intensity < 70) return 2;
  if (intensity < 80) return 3;
  if (intensity < 90) return 4;
  return 5;
}

function batchEvents(events: any[]) {
  const hrEvents = events.filter(e => e.type === 'HR');
  if (hrEvents.length > 0) {
    const avgHR = hrEvents.reduce((acc, curr) => acc + curr.value, 0) / hrEvents.length;
    const values = hrEvents.map(e => e.value);
    const batchFeatures = {
      min: Math.min(...values),
      max: Math.max(...values),
      p90: values.sort((a, b) => a - b)[Math.floor(values.length * 0.9)]
    };

    return [
      ...events.filter(e => e.type !== 'HR'),
      {
        type: 'HR_BATCH',
        value: Math.round(avgHR),
        count: hrEvents.length,
        features: batchFeatures,
        timestamp: events[events.length - 1].timestamp
      }
    ];
  }
  return events;
}

// --- Benchmark Runner ---

async function runWorkerBenchmark() {
  console.log('--- [Performance Test] Shadow Computation ---');

  const iterations = 5000;
  console.log(`1. Benchmarking processSensorData with Feature Extraction (${iterations} iterations)...`);
  
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const res = processSensorData({
      type: 'HR',
      value: 120 + (i % 50),
      metadata: { age: 30 },
      timestamp: new Date().toISOString()
    });
    
    // Verify first few results have features
    if (i === 15) {
      if (!res.processed.features) throw new Error('Feature extraction failed: no features found');
      console.log(`   Sample Feature (iteration 15): HRV Proxy=${res.processed.features.hrvProxy}, Trend=${res.processed.features.trend}, Stats=${JSON.stringify(res.processed.features.windowStats)}`);
    }
  }
  const end = performance.now();
  console.log(`   Result: ${iterations} items processed in ${(end - start).toFixed(2)}ms (${((end - start) / iterations).toFixed(4)}ms/item)`);

  console.log(`\n2. Benchmarking batchEvents (Batching 100 HR events)...`);
  const batchSize = 100;
  const mockEvents = Array.from({ length: batchSize }, (_, i) => ({
    type: 'HR',
    value: 130 + (i % 20),
    timestamp: new Date().toISOString()
  }));

  const bStart = performance.now();
  for (let i = 0; i < 1000; i++) {
    batchEvents(mockEvents);
  }
  const bEnd = performance.now();
  console.log(`   Result: 1000 batches (100k events total) processed in ${(bEnd - bStart).toFixed(2)}ms`);
}

runWorkerBenchmark().catch(console.error);
