import { Character } from "@/entities/characters/Character";
import { IAttackModule } from "@/types/entities";

export class FrenzyCombo implements IAttackModule {
    readonly name = "Frenzy Combo";

    execute(attacker: Character): void {
        console.log(attacker);
    }
}
