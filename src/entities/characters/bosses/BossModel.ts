import { BOSS, CREATURE } from "@/constants/characters";
import type { ICharacterSpec } from "@/types/world";

export function bossSpec(): ICharacterSpec {
    return {
        modelPath: CREATURE.impModelPath,
        height: BOSS.height,
        radius: BOSS.radius,
    };
}
