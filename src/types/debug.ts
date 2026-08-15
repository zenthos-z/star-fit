export interface TraceNode {
  id: string;
  type: 'start' | 'router' | 'agent-local' | 'agent-remote' | 'end';
  label: string;
  description?: string;
}

export interface TraceStep {
  id: string;
  nodeId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime?: number;
  endTime?: number;
  duration?: number;
  inputState?: any;
  outputState?: any;
  logs?: string[];
  error?: any;
}

export interface DebugSession {
  id: string;
  scenario: string;
  intent: string;
  steps: TraceStep[];
  createdAt: number;
}
