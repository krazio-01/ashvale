import { Boss } from "@/entities/characters/Boss";
import { IAttackModule } from "@/types/entities";

export class SteadyStrike implements IAttackModule {
    readonly name = "Steady Strike";

    execute(boss: Boss): void {
        console.log(boss);
    }
}
