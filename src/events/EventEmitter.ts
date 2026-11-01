import type { ICombatEventMap } from "@/events/CombatEvents";

type Listener<Event> = (event: Event) => void;

export type GameEventMap = ICombatEventMap;

export type GameEvents = EventEmitter<GameEventMap>;

export class EventEmitter<EventMap extends object> {
    private readonly listeners: { [Type in keyof EventMap]?: Set<Listener<EventMap[Type]>> } = {};

    on<Type extends keyof EventMap>(type: Type, listener: Listener<EventMap[Type]>): () => void {
        const listeners = (this.listeners[type] ??= new Set<Listener<EventMap[Type]>>());
        listeners.add(listener);

        return () => {
            listeners.delete(listener);
        };
    }

    emit<Type extends keyof EventMap>(type: Type, event: EventMap[Type]): void {
        const listeners = this.listeners[type];
        if (!listeners) return;
        for (const listener of listeners) listener(event);
    }
}
