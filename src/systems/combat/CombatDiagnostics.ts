import { Group } from "three";
import type { Object3D } from "three";
import type { CombatEvents } from "@/systems/combat/services/CombatEvents";
import type { ICombatant } from "@/types/combat";
import type { IWorldContext } from "@/types/world";
import type { IWorldEntity } from "@/types/world";

interface ICombatDiagnostics {
    hits: number;
    kills: number;
    parries: number;
    perfectDodges: number;
    finishers: number;
    staggers: number;
    telegraphs: number;
    lastHitDamage: number;
    sceneRoot: Object3D;
    player: ICombatant | null;
    opponentsWithin: (radius: number) => ICombatant[];
}

declare global {
    var __ashvaleCombat: ICombatDiagnostics | undefined;
}

export class CombatDiagnostics implements IWorldEntity {
    readonly sceneObject = new Group();
    private readonly unsubscribers: (() => void)[];

    constructor(context: IWorldContext, sceneRoot: Object3D, player: ICombatant | null) {
        const events: CombatEvents = context.combatEvents;
        const record: ICombatDiagnostics = {
            hits: 0,
            kills: 0,
            parries: 0,
            perfectDodges: 0,
            finishers: 0,
            staggers: 0,
            telegraphs: 0,
            lastHitDamage: 0,
            sceneRoot,
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
            events.on("hitLanded", (event) => {
                record.hits += 1;
                record.lastHitDamage = event.outcome.damageDealt;
            }),
            events.on("killed", () => {
                record.kills += 1;
            }),
            events.on("parried", () => {
                record.parries += 1;
            }),
            events.on("perfectDodge", () => {
                record.perfectDodges += 1;
            }),
            events.on("finisherKill", () => {
                record.finishers += 1;
            }),
            events.on("staggered", () => {
                record.staggers += 1;
            }),
            events.on("telegraph", () => {
                record.telegraphs += 1;
            }),
        ];
    }

    update(): void {}

    dispose(): void {
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        globalThis.__ashvaleCombat = undefined;
    }
}
