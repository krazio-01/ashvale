import { Character } from "@/entities/characters/Character";
import { IAttackModule } from "@/types/entities";

export class SteadyStrike implements IAttackModule {
    readonly name = "Steady Strike";

    execute(attacker: Character): void {
        console.log(attacker);
    }
}
