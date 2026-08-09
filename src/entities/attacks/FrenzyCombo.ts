import { Boss } from "@/entities/characters/Boss";
import { IAttackModule } from "@/types/entities";

export class FrenzyCombo implements IAttackModule {
    readonly name = "Frenzy Combo";

    execute(boss: Boss): void {
        console.log(boss);
    }
}
