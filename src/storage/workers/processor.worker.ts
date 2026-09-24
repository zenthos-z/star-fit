/**
 * Web Worker for high-frequency data pre-processing (Shadow Computation)
 * Based on TECH_STANDARDS.md
 */

// Worker internal state for trend analysis
const STATE = {
  hrHistory: [] as { value: number; timestamp: number }[],
  maxHistorySize: 100, // Keep last 100 samples
};

self.onmessage = (event: MessageEvent) => {
  const { type, data } = event.data;

  switch (type) {
    case 'PROCESS_SENSOR_DATA':
      const processed = processSensorData(data);
      self.postMessage({ type: 'SENSOR_DATA_PROCESSED', data: processed });
      break;
    
    case 'BATCH_EVENTS':
      const batched = batchEvents(data);
      self.postMessage({ type: 'EVENTS_BATCHED', data: batched });
      break;
    
    case 'RESET_STATE':
      STATE.hrHistory = [];
      break;

    default:
      console.warn(`[Worker] Unknown event type: ${type}`);
  }
};

/**
 * processSensorData: Performs signal processing and feature extraction
 */
function processSensorData(data: any) {
  const { type, value, metadata, timestamp } = data;
  const ts = timestamp ? new Date(timestamp).getTime() : Date.now();
  
  if (type === 'HR') {
    // 1. Basic Intensity Calculation
    const age = metadata?.age || 30; // Default age fallback
    const maxHR = 208 - 0.7 * age;
    const intensity = (value / maxHR) * 100;
    
    // 2. Update internal history for trend analysis
    STATE.hrHistory.push({ value, timestamp: ts });
    if (STATE.hrHistory.length > STATE.maxHistorySize) {
      STATE.hrHistory.shift();
    }

    // 3. Feature Extraction
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

  return {
    ...data,
    processedAt: new Date().toISOString()
  };
}

/**
 * Advanced Feature Extraction for Heart Rate
 */
function extractHRFeatures(history: { value: number; timestamp: number }[], maxHR: number) {
  if (history.length < 2) return null;

  const values = history.map(h => h.value);
  const latest = values[values.length - 1];
  const previous = values[values.length - 2];

  // A. HRV Proxy (RMSSD - Root Mean Square of Successive Differences)
  // Note: True RMSSD requires RR intervals, this is a proxy using HR samples
  let sumSqDiff = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = 60000 / values[i] - 60000 / values[i - 1]; // ms per beat diff
    sumSqDiff += diff * diff;
  }
  const hrvProxy = Math.sqrt(sumSqDiff / (values.length - 1));

  // B. Intensity Slope (Trend)
  // Simple slope over the last 10 samples
  const windowSize = Math.min(10, values.length);
  const window = values.slice(-windowSize);
  const slope = (window[window.length - 1] - window[0]) / windowSize;

  // C. Recovery Indicator
  // If intensity was high (>80%) and is now dropping
  const peakInWindow = Math.max(...values);
  const isRecovering = peakInWindow > maxHR * 0.8 && latest < previous;

  return {
    hrvProxy: Math.round(hrvProxy * 100) / 100,
    slope: Math.round(slope * 100) / 100, // bpm change per sample
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

/**
 * batchEvents: Aggregates high-frequency events to reduce L2/L3 overhead
 */
function batchEvents(events: any[]) {
  // Aggregate HR data by averaging over the batch
  const hrEvents = events.filter(e => e.type === 'HR');
  if (hrEvents.length > 0) {
    const avgHR = hrEvents.reduce((acc, curr) => acc + curr.value, 0) / hrEvents.length;
    
    // Extract features for the batch as a whole
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
