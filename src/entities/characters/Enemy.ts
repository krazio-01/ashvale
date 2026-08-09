import { Character } from "@/entities/characters/Character";
import { EnemyAction } from "@/constants/game";

export abstract class Enemy extends Character {
    abstract decideAction(distanceToPlayer: number): EnemyAction;
    abstract get attackDamage(): number;
}
