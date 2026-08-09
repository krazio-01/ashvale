import type { Boss } from "@/entities/characters/Boss";

export interface IAttackModule {
    readonly name: string;
    execute(boss: Boss): void;
}
