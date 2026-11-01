import { Vector3 } from "three";
import { PHYSICS } from "@/constants/physics";
import type { LinkKind, ParticleSolver } from "@/systems/physics/ParticleSolver";
import type { IClothTuning, IPhysicsBinding, IPhysicsBodyDefinition } from "@/types/physics";
import { ERRORS } from "@/constants/strings";

const scratchFrom = new Vector3();

interface IBodyCounts {
    particles: number;
    stretchLinks: number;
    bendLinks: number;
    tethers: number;
}

export class ClothSheet {
    private static readonly LINK_SPANS: readonly {
        kind: LinkKind;
        span: number;
        alongRow: boolean;
    }[] = [
        { kind: "stretch", span: 1, alongRow: false },
        { kind: "stretch", span: 1, alongRow: true },
        { kind: "bend", span: 2, alongRow: false },
        { kind: "bend", span: 2, alongRow: true },
    ];

    private static readonly scratchHome = new Vector3();

    private static readonly scratchNormal = new Vector3();

    private static readonly scratchPosition = new Vector3();

    private static readonly scratchDown = new Vector3();

    private static readonly scratchAcross = new Vector3();

    readonly tuning: IClothTuning = { ...PHYSICS.cloth };
    readonly counts: IBodyCounts;
    private firstParticle = 0;

    constructor(
        readonly definition: IPhysicsBodyDefinition,
        readonly index: number
    ) {
        if (definition.kind !== "sheet")
            throw new Error(ERRORS.unknownPhysicsBodyKind(definition.name, definition.kind));
        this.reloadTuning();
        const { columns, rows, name, pinned, nearestPin, geodesicDistance } = definition;
        const nodes = columns * rows;
        if (columns < 2 || rows < 2) throw new Error(ERRORS.sheetTooSmall(name));
        const perNode = [definition.nodeBones, pinned, nearestPin, geodesicDistance];
        if (
            perNode.some((values) => values.length !== nodes) ||
            definition.restPositions.length !== nodes * 3 ||
            definition.restNormals.length !== nodes * 3 ||
            definition.skinBones.length !== nodes * 4 ||
            definition.skinWeights.length !== nodes * 4
        )
            throw new Error(ERRORS.sheetNodeMismatch(name, columns, rows));
        nearestPin.forEach((pin, node) => {
            if (!pinned[node] && !(pinned[pin] && Number.isFinite(geodesicDistance[node])))
                throw new Error(ERRORS.sheetNodeUnpinned(name, node));
        });
        this.counts = {
            particles: nodes,
            stretchLinks: rows * (columns - 1) + (rows - 1) * columns,
            bendLinks: rows * Math.max(columns - 2, 0) + Math.max(rows - 2, 0) * columns,
            tethers: pinned.filter((isPinned) => !isPinned).length,
        };
    }

    reloadTuning(): void {
        Object.assign(this.tuning, PHYSICS.cloth, this.definition.feel);
    }

    build(solver: ParticleSolver, binding: IPhysicsBinding): void {
        const unit = binding.unitScale(this.index);
        const body = solver.addBody(this.tuning);
        this.firstParticle = solver.particleCount;
        this.addParticles(solver, binding, body);
        this.addLinks(solver, body, unit);
        this.addTethers(solver, unit);
    }

    updateHomeTargets(solver: ParticleSolver, binding: IPhysicsBinding): void {
        for (let node = 0; node < this.counts.particles; node++) {
            binding.homeWorld(this.index, node, ClothSheet.scratchHome, ClothSheet.scratchNormal);
            solver.setHome(
                this.firstParticle + node,
                ClothSheet.scratchHome,
                ClothSheet.scratchNormal
            );
        }
    }

    resetToRest(solver: ParticleSolver, binding: IPhysicsBinding): void {
        for (let node = 0; node < this.counts.particles; node++) {
            binding.homeWorld(this.index, node, ClothSheet.scratchHome, ClothSheet.scratchNormal);
            solver.resetParticleTo(this.firstParticle + node, ClothSheet.scratchHome);
            solver.setHome(
                this.firstParticle + node,
                ClothSheet.scratchHome,
                ClothSheet.scratchNormal
            );
        }
    }

    writeSimulatedPose(solver: ParticleSolver, binding: IPhysicsBinding): void {
        for (let node = 0; node < this.counts.particles; node++) {
            solver.readPosition(this.firstParticle + node, ClothSheet.scratchPosition);
            sheetTangents(
                this.definition,
                node,
                solver.position,
                this.firstParticle,
                ClothSheet.scratchDown,
                ClothSheet.scratchAcross
            );
            binding.writeNode(
                this.index,
                node,
                ClothSheet.scratchPosition,
                ClothSheet.scratchDown,
                ClothSheet.scratchAcross
            );
        }
    }

    writeAnimatedPose(binding: IPhysicsBinding): void {
        for (let node = 0; node < this.counts.particles; node++)
            binding.writeAnimatedNode(this.index, node);
    }

    private addParticles(solver: ParticleSolver, binding: IPhysicsBinding, body: number): void {
        const { pinned, geodesicDistance } = this.definition;
        const longest = Math.max(...geodesicDistance);
        for (let node = 0; node < this.counts.particles; node++) {
            binding.homeWorld(this.index, node, ClothSheet.scratchHome, ClothSheet.scratchNormal);
            solver.addParticle({
                x: ClothSheet.scratchHome.x,
                y: ClothSheet.scratchHome.y,
                z: ClothSheet.scratchHome.z,
                body,
                pinned: pinned[node],
                hemShare: longest > 0 ? geodesicDistance[node] / longest : 0,
            });
            solver.setHome(
                this.firstParticle + node,
                ClothSheet.scratchHome,
                ClothSheet.scratchNormal
            );
        }
    }

    private addLinks(solver: ParticleSolver, body: number, unit: number): void {
        const { columns, rows } = this.definition;
        for (let row = 0; row < rows; row++)
            for (let column = 0; column < columns; column++) {
                const node = row * columns + column;
                for (const { kind, span, alongRow } of ClothSheet.LINK_SPANS) {
                    if ((alongRow ? row : column) + span >= (alongRow ? rows : columns)) continue;
                    const partner = node + (alongRow ? span * columns : span);
                    solver.addLink(
                        kind,
                        this.firstParticle + node,
                        this.firstParticle + partner,
                        this.restDistance(node, partner, unit),
                        body
                    );
                }
            }
    }

    private addTethers(solver: ParticleSolver, unit: number): void {
        const { pinned, nearestPin, geodesicDistance } = this.definition;
        for (let node = 0; node < this.counts.particles; node++)
            if (!pinned[node])
                solver.addTether(
                    this.firstParticle + node,
                    this.firstParticle + nearestPin[node],
                    geodesicDistance[node] * unit
                );
    }

    private restDistance(a: number, b: number, unit: number): number {
        const rest = this.definition.restPositions;
        return (
            Math.hypot(
                rest[a * 3] - rest[b * 3],
                rest[a * 3 + 1] - rest[b * 3 + 1],
                rest[a * 3 + 2] - rest[b * 3 + 2]
            ) * unit
        );
    }
}

export function sheetTangents(
    { columns, rows }: { columns: number; rows: number },
    node: number,
    points: Float64Array,
    firstPoint: number,
    down: Vector3,
    across: Vector3
): void {
    const row = Math.floor(node / columns);
    const column = node % columns;
    const below = row < rows - 1 ? node + columns : node;
    const above = row < rows - 1 ? node : node - columns;
    const right = column < columns - 1 ? node + 1 : node;
    const left = column < columns - 1 ? node : node - 1;
    down.fromArray(points, (firstPoint + below) * 3).sub(
        scratchFrom.fromArray(points, (firstPoint + above) * 3)
    );
    across
        .fromArray(points, (firstPoint + right) * 3)
        .sub(scratchFrom.fromArray(points, (firstPoint + left) * 3));
}
