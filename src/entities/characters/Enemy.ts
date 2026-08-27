import { EnemyAction } from "@/constants/characters";
import { Character } from "@/entities/characters/Character";

export abstract class Enemy extends Character {
    abstract decideAction(distanceToPlayer: number): EnemyAction;
    abstract get attackDamage(): number;
}
