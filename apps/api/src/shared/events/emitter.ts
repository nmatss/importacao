import { EventEmitter } from 'node:events';

export type ProcessEvent =
  | { type: 'process.created'; payload: { processId: number; processCode: string } }
  | { type: 'process.status_changed'; payload: { processId: number; from: string; to: string } }
  | { type: 'document.uploaded'; payload: { documentId: number; processId: number; type: string } }
  | { type: 'validation.completed'; payload: { processId: number; passed: number; failed: number } }
  | { type: 'espelho.generated'; payload: { processId: number; espelhoId: number } }
  | { type: 'email.ingested'; payload: { emailId: number; processId?: number } };

class AppEventEmitter {
  private emitter = new EventEmitter();

  emit<T extends ProcessEvent>(event: T): void {
    this.emitter.emit(event.type, event.payload);
  }

  on<T extends ProcessEvent['type']>(
    eventType: T,
    handler: (payload: Extract<ProcessEvent, { type: T }>['payload']) => void,
  ): void {
    this.emitter.on(eventType, handler);
  }

  off<T extends ProcessEvent['type']>(
    eventType: T,
    handler: (payload: Extract<ProcessEvent, { type: T }>['payload']) => void,
  ): void {
    this.emitter.off(eventType, handler);
  }

  once<T extends ProcessEvent['type']>(
    eventType: T,
    handler: (payload: Extract<ProcessEvent, { type: T }>['payload']) => void,
  ): void {
    this.emitter.once(eventType, handler);
  }

  listenerCount(eventType: ProcessEvent['type']): number {
    return this.emitter.listenerCount(eventType);
  }
}

export const appEvents = new AppEventEmitter();
