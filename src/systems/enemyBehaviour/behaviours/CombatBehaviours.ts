import { Vector3 } from "three";
import { EnemyBehaviour } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { IEnemyCombatBody } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import type {
    IEnemyAttack,
    IAttackThreat,
    IAttackThreatSource,
    ICombatant,
    IDefenseTactics,
} from "@/types/combat";
import type { AttackCoordinator } from "@/systems/combat/AttackCoordinator";
import { ENEMY_DEFENSE_MOVE_IDS } from "@/systems/combat/moveSets/enemyMoveBuilders";
import { ENGAGE_TACTICS, SPAM_TRACKER } from "@/constants/enemies";
import {
    countDownTimers,
    shortestAngleBetween,
    clamp,
    horizontalDistance,
    yawTowards,
    pointAtYaw,
} from "@/lib/helpers";

type Tactic = "close" | "circle" | "attack" | "retreat";

type EngageTarget = ICombatant & IAttackThreatSource;

type DefenseMove = "parry" | "evade";

type DefenseDecision = DefenseMove | "take";

class AttackPlanner {
    private static readonly REPEAT_WEIGHT_SCALE = 0.5;

    private readonly attacks: readonly IEnemyAttack[];
    private readonly random: () => number;
    private readonly cooldowns = new Map<string, number>();
    private lastAttackId: string | null = null;

    constructor(attacks: readonly IEnemyAttack[], random: () => number) {
        this.attacks = attacks;
        this.random = random;
    }

    tick(deltaSeconds: number, cooldownRate: number): void {
        countDownTimers(this.cooldowns, deltaSeconds * cooldownRate);
    }

    pick(gap: number): IEnemyAttack | null {
        let totalWeight = 0;
        for (const attack of this.attacks)
            if (this.isAvailable(attack, gap)) totalWeight += this.weightOf(attack);
        if (totalWeight === 0) return null;

        let roll = this.random() * totalWeight;
        let chosen: IEnemyAttack | null = null;
        for (const attack of this.attacks) {
            if (!this.isAvailable(attack, gap)) continue;
            chosen = attack;
            roll -= this.weightOf(attack);
            if (roll < 0) break;
        }
        return chosen;
    }

    commit(attack: IEnemyAttack): void {
        if (attack.cooldownSeconds > 0) this.cooldowns.set(attack.id, attack.cooldownSeconds);
        this.lastAttackId = attack.id;
    }

    private isAvailable(attack: IEnemyAttack, gap: number): boolean {
        return gap >= attack.range[0] && gap <= attack.range[1] && !this.cooldowns.has(attack.id);
    }

    private weightOf(attack: IEnemyAttack): number {
        return attack.id === this.lastAttackId
            ? attack.weight * AttackPlanner.REPEAT_WEIGHT_SCALE
            : attack.weight;
    }
}

class DefenseDecider {
    private static readonly REACT_BEFORE_HIT_SECONDS: Record<DefenseMove, number> = {
        parry: 0.15,
        evade: 0.2,
    };

    private readonly tactics: IDefenseTactics;
    private readonly random: () => number;
    private readonly hitTimes: number[] = [];
    private elapsed = 0;
    private trackedSerial = -1;
    private decision: DefenseDecision | null = null;
    private reactionDelayRemaining = 0;
    private hasReacted = false;

    constructor(tactics: IDefenseTactics, random: () => number) {
        this.tactics = tactics;
        this.random = random;
    }

    notifyLightHitLanded(): void {
        this.hitTimes.push(this.elapsed);
    }

    tick(deltaSeconds: number, threat: IAttackThreat | null): DefenseMove | null {
        this.elapsed += deltaSeconds;
        const cutoff = this.elapsed - SPAM_TRACKER.windowSeconds;
        while ((this.hitTimes[0] ?? Number.POSITIVE_INFINITY) < cutoff) this.hitTimes.shift();

        if (!threat) {
            this.trackedSerial = -1;
            this.decision = null;
            return null;
        }

        if (threat.moveSerial !== this.trackedSerial) {
            this.trackedSerial = threat.moveSerial;
            this.hasReacted = false;
            this.reactionDelayRemaining = this.tactics.reactionSeconds;
            this.decision = threat.secondsUntilHit < this.tactics.reactionSeconds ? "take" : null;
        }

        if (this.decision === null) {
            this.reactionDelayRemaining -= deltaSeconds;
            if (this.reactionDelayRemaining <= 0) this.decision = this.roll(threat);
        }

        const decision = this.decision;
        if (this.hasReacted || decision === null || decision === "take") return null;
        if (threat.secondsUntilHit > DefenseDecider.REACT_BEFORE_HIT_SECONDS[decision]) return null;

        this.hasReacted = true;
        return decision;
    }

    private roll(threat: IAttackThreat): DefenseDecision {
        const roll = this.random();
        if (!threat.parryable || threat.dodgeOnly)
            return roll < this.tactics.evadeChance ? "evade" : "take";

        const parryBonus = Math.min(
            SPAM_TRACKER.maxBonus,
            this.hitTimes.length * SPAM_TRACKER.bonusPerHit
        );
        const parryChance = Math.min(1, this.tactics.parryChance + parryBonus);
        if (roll < parryChance) return "parry";
        return roll < parryChance + this.tactics.evadeChance ? "evade" : "take";
    }
}

export class EngageBehaviour extends EnemyBehaviour<IEnemyCombatBody> {
    private static readonly scratchRingPoint = new Vector3();

    private readonly target: EngageTarget;
    private readonly coordinator: AttackCoordinator;
    private readonly enemyId: string;
    private readonly planner: AttackPlanner;
    private readonly defense: DefenseDecider;
    private readonly cheapestTokenCost: number;
    private currentTactic: Tactic = "close";
    private plannedAttack: IEnemyAttack | null = null;
    private readonly comboSteps: string[] = [];
    private comboIndex = 0;
    private tacticChoiceRemaining = 0;
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
        this.defense = new DefenseDecider(body.archetype.tactics, random);
    }

    enter(): void {
        this.body.startFacingTarget();
        this.tacticChoiceRemaining = 0;
    }

    exit(): void {
        this.body.stopFacingTarget();
        this.coordinator.releaseRingSlot(this.enemyId);
        this.abandonCombo();
    }

    notifyLightHitLanded(): void {
        this.defense.notifyLightHitLanded();
    }

    tick(deltaSeconds: number): void {
        const tactics = this.body.archetype.tactics;
        const isFrenzied = this.body.healthFraction < tactics.frenzyBelowHealth;
        const isPunishWindow = this.target.isReeling;
        this.planner.tick(
            deltaSeconds,
            (isFrenzied ? 1 / tactics.frenzyCooldownScale : 1) *
                (isPunishWindow ? ENGAGE_TACTICS.punishCooldownRate : 1)
        );

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

        this.tacticChoiceRemaining -= deltaSeconds;
        if (
            this.tacticChoiceRemaining <= 0 ||
            (isPunishWindow && this.currentTactic !== "attack")
        ) {
            this.currentTactic = this.chooseTactic(gap);
            this.tacticChoiceRemaining = ENGAGE_TACTICS.tacticChoiceSeconds;
        }

        if (this.currentTactic !== "circle") this.coordinator.releaseRingSlot(this.enemyId);
        this.performTactic(this.currentTactic, gap, targetPosition, targetRadius);
    }

    private chooseTactic(gap: number): Tactic {
        const isTargetInFinisher = this.target.isInFinisher;
        const attack = this.planner.pick(gap);
        if (
            attack !== null &&
            this.coordinator.canTakeAttackToken(attack.tokenCost, isTargetInFinisher)
        ) {
            this.plannedAttack = attack;
            return "attack";
        }
        const retreatRange = this.body.archetype.tactics.retreatRange;
        if (retreatRange > 0 && gap < retreatRange) return "retreat";
        if (!this.coordinator.canTakeAttackToken(this.cheapestTokenCost, isTargetInFinisher))
            return "circle";
        return "close";
    }

    private performTactic(
        tactic: Tactic,
        gap: number,
        targetPosition: Vector3,
        targetRadius: number
    ): void {
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
            const slotPoint = pointAtYaw(
                targetPosition,
                slotAngle,
                ringRadius,
                EngageBehaviour.scratchRingPoint
            );
            const slotError = Math.hypot(
                slotPoint.x - body.position.x,
                slotPoint.z - body.position.z
            );
            if (slotError > ENGAGE_TACTICS.ringDeadZone) this.isRepositioning = true;
            else if (slotError <= ENGAGE_TACTICS.ringSettleDistance) this.isRepositioning = false;
            if (!this.isRepositioning) {
                body.holdStill();
                return;
            }

            const angle =
                bearing +
                clamp(shortestAngleBetween(bearing, slotAngle), -maxAngleStep, maxAngleStep);
            pointAtYaw(targetPosition, angle, ringRadius, EngageBehaviour.scratchRingPoint);
            body.moveTowards(EngageBehaviour.scratchRingPoint, orbitSpeed, 0);
            return;
        }

        const attack = this.plannedAttack;
        const isTargetInFinisher = this.target.isInFinisher;
        if (
            !attack ||
            gap < attack.range[0] ||
            gap > attack.range[1] ||
            !this.coordinator.canTakeAttackToken(attack.tokenCost, isTargetInFinisher)
        ) {
            this.currentTactic = this.chooseTactic(gap);
            this.performTactic(this.currentTactic, gap, targetPosition, targetRadius);
            return;
        }

        body.holdStill();
        if (!body.performMove(attack.openingMove)) return;

        this.rollCombo(attack);
        this.coordinator.tryTakeAttackToken(
            this.enemyId,
            attack.tokenCost,
            this.comboSteps.length - 1,
            isTargetInFinisher
        );
        this.planner.commit(attack);
        this.plannedAttack = null;
        this.currentTactic = "close";
        this.tacticChoiceRemaining = ENGAGE_TACTICS.tacticChoiceSeconds;
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
            this.abandonCombo();
            return false;
        }

        const next = steps[this.comboIndex + 1];
        if (next !== undefined && this.body.performMove(next)) this.comboIndex += 1;
        return true;
    }

    private abandonCombo(): void {
        if (this.comboIndex < this.comboSteps.length - 1)
            this.coordinator.dropComboExtension(this.enemyId);
        this.comboSteps.length = 0;
    }
}
