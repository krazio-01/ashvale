import type { Boss } from "@/entities/characters/Boss";

export interface IAttackModule {
    readonly name: string;
    execute(boss: Boss): void;
}

export interface IWeapon {
    name: string;
    damage: number;
}
