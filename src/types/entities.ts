import type { Character } from "@/entities/characters/Character";

export interface IAttackModule {
    readonly name: string;
    execute(attacker: Character): void;
}

export interface IWeapon {
    name: string;
    damage: number;
}
