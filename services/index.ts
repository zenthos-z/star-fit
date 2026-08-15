export * from './featureFlags';
export * from './geminiService';
export * from './syncService';
// Re-export WebSocketClient as socketService for unified transport
export { socketService } from '../src/v2/services/transport/WebSocketClient';
export * from './exerciseLibraryService';
