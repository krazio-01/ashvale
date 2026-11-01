import { Group } from "three";
import type { ICombatant } from "@/types/combat";
import type { IWorldContext } from "@/types/world";
import type { IWorldEntity } from "@/types/world";

interface ICombatDiagnostics {
    kills: number;
    finishers: number;
    player: ICombatant | null;
    opponentsWithin: (radius: number) => ICombatant[];
}

declare global {
    var __ashvaleCombat: ICombatDiagnostics | undefined;
}

export class CombatDiagnostics implements IWorldEntity {
    readonly sceneObject = new Group();
    private readonly unsubscribers: (() => void)[];

    constructor(context: IWorldContext, player: ICombatant | null) {
        const events = context.events;
        const record: ICombatDiagnostics = {
            kills: 0,
            finishers: 0,
            player,
            opponentsWithin: (radius) =>
                player
                    ? context.combatRegistry.collectOpponents(
                          player.team,
                          player.sceneObject.position,
                          radius,
                          []
                      )
                    : [],
        };
        globalThis.__ashvaleCombat = record;

        this.unsubscribers = [
            events.on("killed", () => {
                record.kills += 1;
            }),
            events.on("finisherKill", () => {
                record.finishers += 1;
            }),
        ];
    }

    update(): void {}

    dispose(): void {
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        globalThis.__ashvaleCombat = undefined;
    }
}
