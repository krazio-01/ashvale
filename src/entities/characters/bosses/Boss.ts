import { Character } from "@/entities/characters/Character";
import { IAttackModule } from "@/types/entities";

export class Boss extends Character {
    readonly contributorLogin: string;
    private readonly attackModules: IAttackModule[];
    private readonly aggression: number;

    constructor(
        id: string,
        contributorLogin: string,
        maxHealth: number,
        attackModules: IAttackModule[],
        aggression: number
    ) {
        super(id, maxHealth);
        this.contributorLogin = contributorLogin;
        this.attackModules = attackModules;
        this.aggression = aggression;
    }

    get attackFrequency(): number {
        return this.aggression;
    }

    chooseAttack(): IAttackModule {
        const index = Math.floor(Math.random() * this.attackModules.length);
        return this.attackModules[index];
    }
}
