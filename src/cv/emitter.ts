import type { CoachEventMap } from './types';

type Handler<K extends keyof CoachEventMap> = (payload: CoachEventMap[K]) => void;

/** Minimal typed event emitter shared by the real and the mock coach. */
export class CoachEmitter {
  private handlers: { [K in keyof CoachEventMap]?: Set<Handler<K>> } = {};

  on<K extends keyof CoachEventMap>(type: K, handler: Handler<K>): () => void {
    const set = (this.handlers[type] ??= new Set<Handler<K>>() as never) as Set<Handler<K>>;
    set.add(handler);
    return () => set.delete(handler);
  }

  emit<K extends keyof CoachEventMap>(type: K, payload: CoachEventMap[K]): void {
    const set = this.handlers[type] as Set<Handler<K>> | undefined;
    set?.forEach((handler) => handler(payload));
  }

  clear(): void {
    this.handlers = {};
  }
}
