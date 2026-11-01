import { Vector3 } from "three";
import type { CombatRegistry } from "@/systems/combat/CombatRegistry";
import { ENEMY_STEERING, OBSTACLE_PROBE } from "@/constants/enemies";
import { COMBAT_MOVEMENT } from "@/constants/combat";
import {
    shortestAngleBetween,
    yawFromDirection,
    forwardFromYaw,
    horizontalLength,
} from "@/lib/helpers";
import type { ICombatant } from "@/types/combat";

interface ISteeringBody extends ICombatant {
    readonly bodyRadius: number;
    readonly position: Vector3;
    isObstacleAhead(directionX: number, directionZ: number, distance: number): boolean;
}

export class EnemySteering {
    private static readonly scratchSeparation = new Vector3();

    private static readonly scratchTeammates: ICombatant[] = [];

    private readonly body: ISteeringBody;
    private readonly registry: CombatRegistry;
    private avoidanceSide = 0;
    private probeAgeSeconds = Number.POSITIVE_INFINITY;
    private probedHeading = 0;
    private probedLookahead = 0;
    private avoidanceTurn: number | null = 0;

    constructor(body: ISteeringBody, registry: CombatRegistry) {
        this.body = body;
        this.registry = registry;
    }

    tick(deltaSeconds: number): void {
        this.probeAgeSeconds += deltaSeconds;
    }

    steer(direction: Vector3, speed: number, clearDistance: number): void {
        direction.add(this.separationFromTeammates());
        const length = horizontalLength(direction);
        if (length < COMBAT_MOVEMENT.minimumPlanarLength) {
            direction.set(0, 0, 0);
            return;
        }

        direction.divideScalar(Math.max(1, length));
        this.steerAroundObstacles(direction, speed, clearDistance);
        direction.multiplyScalar(speed);
    }

    private separationFromTeammates(): Vector3 {
        const separation = EnemySteering.scratchSeparation.set(0, 0, 0);
        const position = this.body.position;
        const ownRadius = this.body.bodyRadius;
        const teammates = this.registry.collectTeammates(
            this.body.team,
            position,
            ownRadius * 2 + ENEMY_STEERING.separationMargin,
            EnemySteering.scratchTeammates
        );

        for (const teammate of teammates) {
            if (teammate === this.body) continue;

            const offsetX = position.x - teammate.sceneObject.position.x;
            const offsetZ = position.z - teammate.sceneObject.position.z;
            const distance = Math.hypot(offsetX, offsetZ);
            const comfortable = ownRadius + teammate.bodyRadius + ENEMY_STEERING.separationMargin;
            if (distance >= comfortable || distance < COMBAT_MOVEMENT.minimumPlanarLength) continue;

            const intrusion = Math.min(
                ENEMY_STEERING.maximumSeparationPush,
                (comfortable - distance) / ENEMY_STEERING.separationMargin
            );
            const push = intrusion * ENEMY_STEERING.separationStrength;
            separation.x += (offsetX / distance) * push;
            separation.z += (offsetZ / distance) * push;
        }

        return separation;
    }

    private steerAroundObstacles(direction: Vector3, speed: number, clearDistance: number): void {
        const lookahead = Math.min(
            speed * ENEMY_STEERING.obstacleLookaheadSeconds,
            Math.max(0, clearDistance - ENEMY_STEERING.separationMargin)
        );
        if (lookahead <= 0) {
            this.avoidanceSide = 0;
            this.probeAgeSeconds = Number.POSITIVE_INFINITY;
            return;
        }

        const length = horizontalLength(direction);
        const heading = yawFromDirection(direction.x, direction.z);
        const isProbeStale =
            this.probeAgeSeconds >= OBSTACLE_PROBE.cacheSeconds ||
            lookahead > this.probedLookahead * OBSTACLE_PROBE.reprobeLookaheadGrowth ||
            Math.abs(shortestAngleBetween(this.probedHeading, heading)) >
                OBSTACLE_PROBE.reprobeHeadingChange;
        if (isProbeStale) {
            this.avoidanceTurn = this.probeAvoidanceTurn(
                direction.x / length,
                direction.z / length,
                lookahead
            );
            this.probeAgeSeconds = 0;
            this.probedHeading = heading;
            this.probedLookahead = lookahead;
        }

        const turn = this.avoidanceTurn;
        if (turn === null || turn === 0) return;
        const steeredHeading = heading + turn;
        forwardFromYaw(steeredHeading, direction, length);
    }

    private probeAvoidanceTurn(
        forwardX: number,
        forwardZ: number,
        lookahead: number
    ): number | null {
        if (!this.body.isObstacleAhead(forwardX, forwardZ, lookahead)) {
            this.avoidanceSide = 0;
            return 0;
        }

        const firstSide = this.avoidanceSide === 0 ? 1 : this.avoidanceSide;

        for (let attempt = 1; attempt <= ENEMY_STEERING.avoidanceAttempts; attempt += 1) {
            for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
                const side = sideIndex === 0 ? firstSide : -firstSide;
                const angle = side * attempt * ENEMY_STEERING.avoidanceTurnStep;
                const cosine = Math.cos(angle);
                const sine = Math.sin(angle);
                const steeredX = forwardX * cosine + forwardZ * sine;
                const steeredZ = -forwardX * sine + forwardZ * cosine;
                if (this.body.isObstacleAhead(steeredX, steeredZ, lookahead)) continue;

                this.avoidanceSide = side;
                return angle;
            }
        }
        return null;
    }
}
