import type { SpamTracker } from "@/systems/enemyBehaviour/combat/SpamTracker";
import type { IAttackThreat } from "@/types/combat";

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
