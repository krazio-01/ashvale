import { SPAM_TRACKER, ENGAGE_TACTICS } from "@/constants/enemies";
import type { IAttackThreat, IAttackThreatSource, ICombatant } from "@/types/combat";
import { Vector3 } from "three";
import { EnemyBehaviour } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { IEnemyCombatBody } from "@/systems/enemyBehaviour/behaviours/EnemyBehaviour";
import type { AwarenessMeter } from "@/systems/enemyBehaviour/perception/AwarenessMeter";
import type { AttackCoordinator } from "@/systems/combat/AttackCoordinator";
import { ENEMY_DEFENSE_MOVE_IDS } from "@/systems/combat/moveSets/enemyMoveBuilders";
import { angleDelta, clamp, horizontalDistance, yawTowards } from "@/lib/helpers";

export class SpamTracker {
    private readonly hitTimes: number[] = [];
    private elapsed = 0;

    tick(deltaSeconds: number): void {
        this.elapsed += deltaSeconds;
        const cutoff = this.elapsed - SPAM_TRACKER.windowSeconds;
        while ((this.hitTimes[0] ?? Number.POSITIVE_INFINITY) < cutoff) this.hitTimes.shift();
    }

    notifyLightHitLanded(): void {
        this.hitTimes.push(this.elapsed);
    }

    parryBonus(): number {
        return Math.min(SPAM_TRACKER.maxBonus, this.hitTimes.length * SPAM_TRACKER.bonusPerHit);
    }
}

export interface IDefenseTactics {
    reactionSeconds: number;
    parryChance: number;
    evadeChance: number;
}

type DefenseMove = "parry" | "evade";
type DefenseRoll = DefenseMove | "take";

const LEAD_SECONDS: Record<DefenseMove, number> = { parry: 0.15, evade: 0.2 };

export class DefenseReader {
    private readonly tactics: IDefenseTactics;
    private readonly spam: SpamTracker;
    private readonly random: () => number;
    private trackedSerial = -1;
    private decision: DefenseRoll | null = null;
    private noticeRemaining = 0;
    private triggered = false;

    constructor(tactics: IDefenseTactics, spam: SpamTracker, random: () => number) {
        this.tactics = tactics;
        this.spam = spam;
        this.random = random;
    }

    tick(deltaSeconds: number, threat: IAttackThreat | null): DefenseMove | null {
        if (!threat) {
            this.trackedSerial = -1;
            this.decision = null;
            return null;
        }

        if (threat.moveSerial !== this.trackedSerial) {
            this.trackedSerial = threat.moveSerial;
            this.triggered = false;
            this.noticeRemaining = this.tactics.reactionSeconds;
            this.decision = threat.secondsUntilHit < this.tactics.reactionSeconds ? "take" : null;
        }

        if (this.decision === null) {
            this.noticeRemaining -= deltaSeconds;
            if (this.noticeRemaining <= 0) this.decision = this.roll(threat);
        }

        const decision = this.decision;
        if (this.triggered || decision === null || decision === "take") return null;
        if (threat.secondsUntilHit > LEAD_SECONDS[decision]) return null;

        this.triggered = true;
        return decision;
    }

    private roll(threat: IAttackThreat): DefenseRoll {
        const roll = this.random();
        if (!threat.parryable || threat.perilous)
            return roll < this.tactics.evadeChance ? "evade" : "take";

        const parryChance = Math.min(1, this.tactics.parryChance + this.spam.parryBonus());
        if (roll < parryChance) return "parry";
        return roll < parryChance + this.tactics.evadeChance ? "evade" : "take";
    }
}

export interface IEnemyAttack {
    id: string;
    openingMove: string;
    range: readonly [number, number];
    weight: number;
    cooldownSeconds: number;
    tokenCost: number;
    chain: readonly string[];
    continueChance: number;
}

const REPEAT_WEIGHT_SCALE = 0.5;

export class AttackPlanner {
    private readonly attacks: readonly IEnemyAttack[];
    private readonly random: () => number;
    private readonly cooldowns = new Map<string, number>();
    private lastAttackId: string | null = null;

    constructor(attacks: readonly IEnemyAttack[], random: () => number) {
        this.attacks = attacks;
        this.random = random;
    }

    tick(deltaSeconds: number, cooldownRate = 1): void {
        for (const [id, remaining] of this.cooldowns) {
            const next = remaining - deltaSeconds * cooldownRate;
            if (next <= 0) this.cooldowns.delete(id);
            else this.cooldowns.set(id, next);
        }
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
            ? attack.weight * REPEAT_WEIGHT_SCALE
            : attack.weight;
    }
}

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
        this.abandonCombo();
    }

    notifyLightHitLanded(): void {
        this.spam.notifyLightHitLanded();
    }

    tick(deltaSeconds: number): void {
        this.spam.tick(deltaSeconds);
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

        this.rescoreRemaining -= deltaSeconds;
        if (this.rescoreRemaining <= 0 || (isPunishWindow && this.currentTactic !== "attack")) {
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
        this.coordinator.tryAcquire(
            this.enemyId,
            attack.tokenCost,
            this.comboSteps.length - 1,
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
            this.abandonCombo();
            return false;
        }

        const next = steps[this.comboIndex + 1];
        if (next !== undefined && this.body.performMove(next)) this.comboIndex += 1;
        return true;
    }

    private abandonCombo(): void {
        if (this.comboIndex < this.comboSteps.length - 1)
            this.coordinator.dropExtension(this.enemyId);
        this.comboSteps.length = 0;
    }
}
