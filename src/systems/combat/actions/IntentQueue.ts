import type { IntentKind } from "@/types/combat";

interface IQueuedIntent {
    intent: IntentKind;
    ageSeconds: number;
}

export class IntentQueue {
    private readonly lifetimeSeconds: number;
    private readonly capacity: number;
    private readonly entries: IQueuedIntent[] = [];

    constructor(lifetimeSeconds: number, capacity: number) {
        this.lifetimeSeconds = lifetimeSeconds;
        this.capacity = capacity;
    }

    get size(): number {
        return this.entries.length;
    }

    intentAt(index: number): IntentKind | null {
        return this.entries[index]?.intent ?? null;
    }

    push(intent: IntentKind): void {
        if (this.entries.length >= this.capacity) this.entries.shift();
        this.entries.push({ intent, ageSeconds: 0 });
    }

    removeAt(index: number): void {
        this.entries.splice(index, 1);
    }

    removeThrough(index: number): void {
        this.entries.splice(0, index + 1);
    }

    clear(): void {
        this.entries.length = 0;
    }

    tick(realDeltaSeconds: number): void {
        for (let index = this.entries.length - 1; index >= 0; index -= 1) {
            const entry = this.entries[index];
            if (!entry) continue;

            entry.ageSeconds += realDeltaSeconds;
            if (entry.ageSeconds > this.lifetimeSeconds) this.entries.splice(index, 1);
        }
    }
}
