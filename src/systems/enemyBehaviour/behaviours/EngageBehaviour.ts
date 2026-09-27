import { Vector3 } from "three";
import { EnemyBehaviour } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { IEnemyCombatBody } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import { AttackPlanner } from "@/systems/enemyBehaviour/combat/AttackPlanner";
import type { IEnemyAttack } from "@/systems/enemyBehaviour/combat/AttackPlanner";
import { DefenseReader } from "@/systems/enemyBehaviour/combat/DefenseReader";
import { SpamTracker } from "@/systems/enemyBehaviour/combat/SpamTracker";
import type { AttackCoordinator } from "@/systems/combat/services/AttackCoordinator";
import { ENEMY_DEFENSE_MOVE_IDS } from "@/systems/combat/moveSets/enemy/enemyMoveKit";
import { ATTACK_COORDINATOR, ENGAGE_TACTICS } from "@/constants/enemies";
import { angleDelta, clamp, horizontalDistance, yawTowards } from "@/lib/helpers";
import type { IAttackThreatSource, ICombatant } from "@/types/combat";

type Tactic = "close" | "circle" | "attack" | "retreat";
type EngageTarget = ICombatant & IAttackThreatSource;

const scratchRingPoint = new Vector3();

export class EngageBehaviour extends EnemyBehaviour<IEnemyCombatBody> {
    private readonly target: EngageTarget;
    private readonly coordinator: AttackCoordinator;
    private readonly enemyId: string;
    private readonly planner: AttackPlanner;
    private readonly spam = new SpamTracker();
    private readonly defense: DefenseReader;
    private readonly cheapestTokenCost: number;
    private currentTactic: Tactic = "close";
    private plannedAttack: IEnemyAttack | null = null;
    private readonly comboSteps: string[] = [];
    private comboIndex = 0;
    private rescoreRemaining = 0;
    private isRepositioning = true;

    constructor(
        body: IEnemyCombatBody,
        awareness: AwarenessMeter,
        target: EngageTarget,
        random: () => number,
        coordinator: AttackCoordinator,
        enemyId: string
    ) {
        super(body, awareness, random);
        this.target = target;
        this.coordinator = coordinator;
        this.enemyId = enemyId;
        this.planner = new AttackPlanner(body.archetype.attacks, random);
        this.cheapestTokenCost = Math.min(
            ...body.archetype.attacks.map((attack) => attack.tokenCost)
        );
        this.defense = new DefenseReader(body.archetype.tactics, this.spam, random);
    }

    enter(): void {
        this.body.faceTarget();
        this.rescoreRemaining = 0;
    }

    exit(): void {
        this.body.relax();
        this.coordinator.releaseRingSlot(this.enemyId);
    }

    notifyLightHitLanded(): void {
        this.spam.notifyLightHitLanded();
    }

    tick(deltaSeconds: number): void {
        this.spam.tick(deltaSeconds);
        const tactics = this.body.archetype.tactics;
        const isFrenzied = this.body.healthFraction < tactics.frenzyBelowHealth;
        this.planner.tick(deltaSeconds, isFrenzied ? 1 / tactics.frenzyCooldownScale : 1);

        const isAimedAtMe = this.target.currentTarget?.id === this.enemyId;
        const threat = isAimedAtMe ? this.target.attackThreat : null;
        const defenseMove = this.defense.tick(deltaSeconds, threat);
        if (defenseMove) {
            this.body.performMove(
                defenseMove === "parry"
                    ? ENEMY_DEFENSE_MOVE_IDS.parry
                    : ENEMY_DEFENSE_MOVE_IDS.dodge
            );
            return;
        }

        if (this.continueCombo()) return;

        const body = this.body;
        const targetPosition = this.target.sceneObject.position;
        const targetRadius = this.target.bodyRadius;
        const gap =
            horizontalDistance(body.position, targetPosition) - body.bodyRadius - targetRadius;

        this.rescoreRemaining -= deltaSeconds;
        if (this.rescoreRemaining <= 0) {
            this.currentTactic = this.chooseTactic(gap);
            this.rescoreRemaining = ENGAGE_TACTICS.rescoreSeconds;
        }

        if (this.currentTactic !== "circle") this.coordinator.releaseRingSlot(this.enemyId);
        this.act(this.currentTactic, gap, targetPosition, targetRadius);
    }

    private chooseTactic(gap: number): Tactic {
        const isPaired = this.target.isPaired;
        const attack = this.planner.pick(gap);
        if (attack !== null && this.coordinator.canAcquire(attack.tokenCost, isPaired)) {
            this.plannedAttack = attack;
            return "attack";
        }
        const retreatRange = this.body.archetype.tactics.retreatRange;
        if (retreatRange > 0 && gap < retreatRange) return "retreat";
        if (!this.coordinator.canAcquire(this.cheapestTokenCost, isPaired)) return "circle";
        return "close";
    }

    private act(tactic: Tactic, gap: number, targetPosition: Vector3, targetRadius: number): void {
        const body = this.body;
        const combatSpeed = body.archetype.combatSpeed;

        if (tactic === "retreat") {
            body.moveAwayFrom(targetPosition, combatSpeed);
            return;
        }

        if (tactic === "close") {
            const strikingDistance =
                body.bodyRadius +
                targetRadius +
                body.archetype.tactics.preferredRange * ENGAGE_TACTICS.closeStopFraction;
            body.moveTowards(targetPosition, combatSpeed, strikingDistance, targetRadius);
            return;
        }

        if (tactic === "circle") {
            const bearing = yawTowards(targetPosition, body.position);
            const slotAngle = this.coordinator.claimRingAngle(this.enemyId, bearing);
            const heldGap = clamp(gap, ENGAGE_TACTICS.waitingMinGap, ENGAGE_TACTICS.waitingGap);
            const ringRadius = heldGap + body.bodyRadius + targetRadius;
            const orbitSpeed = combatSpeed * ENGAGE_TACTICS.circleSpeedFraction;
            const maxAngleStep = (orbitSpeed * ENGAGE_TACTICS.orbitLookaheadSeconds) / ringRadius;
            const slotError = Math.hypot(
                targetPosition.x + Math.sin(slotAngle) * ringRadius - body.position.x,
                targetPosition.z + Math.cos(slotAngle) * ringRadius - body.position.z
            );
            if (slotError > ENGAGE_TACTICS.ringDeadZone) this.isRepositioning = true;
            else if (slotError <= ENGAGE_TACTICS.ringSettleDistance) this.isRepositioning = false;
            if (!this.isRepositioning) {
                body.holdStill();
                return;
            }

            const angle =
                bearing + clamp(angleDelta(bearing, slotAngle), -maxAngleStep, maxAngleStep);
            scratchRingPoint.set(
                targetPosition.x + Math.sin(angle) * ringRadius,
                targetPosition.y,
                targetPosition.z + Math.cos(angle) * ringRadius
            );
            body.moveTowards(scratchRingPoint, orbitSpeed, 0);
            return;
        }

        const attack = this.plannedAttack;
        const isPaired = this.target.isPaired;
        if (
            !attack ||
            gap < attack.range[0] ||
            gap > attack.range[1] ||
            !this.coordinator.canAcquire(attack.tokenCost, isPaired)
        ) {
            this.currentTactic = this.chooseTactic(gap);
            this.act(this.currentTactic, gap, targetPosition, targetRadius);
            return;
        }

        body.holdStill();
        if (!body.performMove(attack.openingMove)) return;

        this.rollCombo(attack);
        const comboSeconds = ATTACK_COORDINATOR.comboStepSeconds * (this.comboSteps.length - 1);
        this.coordinator.tryAcquire(
            attack.tokenCost,
            ATTACK_COORDINATOR.holdSeconds + comboSeconds,
            isPaired
        );
        this.planner.commit(attack);
        this.plannedAttack = null;
        this.currentTactic = "close";
        this.rescoreRemaining = ENGAGE_TACTICS.rescoreSeconds;
    }

    private rollCombo(attack: IEnemyAttack): void {
        const steps = this.comboSteps;
        steps.length = 0;
        steps.push(attack.openingMove);
        for (const next of attack.chain) {
            if (this.random() >= attack.continueChance) break;
            steps.push(next);
        }
        this.comboIndex = 0;
    }

    private continueCombo(): boolean {
        const steps = this.comboSteps;
        if (steps.length === 0) return false;

        if (this.body.activeMoveId !== steps[this.comboIndex]) {
            steps.length = 0;
            return false;
        }

        const next = steps[this.comboIndex + 1];
        if (next !== undefined && this.body.performMove(next)) this.comboIndex += 1;
        return true;
    }
}
