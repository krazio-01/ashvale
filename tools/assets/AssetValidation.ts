import { Box3, MathUtils, Vector3, type Vector3Tuple } from "three";
import type { ISkeletonDescriptor, SkeletonSide } from "@/types/characters";
import type { IStaticPieceExtras } from "@/types/world";
import type { AssetBuild, IBuildRecipe, IDetectionReport } from "./AssetBuilds";
import type {
    CharacterJoints,
    IBoundsMetres,
    IKitPartBounds,
    IResolvedCharacterRecipe,
    IResolvedImportedRecipe,
    IResolvedKitRecipe,
    IResolvedScanRecipe,
    IResolvedSculptRecipe,
} from "./AssetManifest";
import { MILLIMETRES_PER_METRE } from "../pipeline";

export const VALIDATION_LIMITS = {
    garmentArmShareSlack: 0.02,
    latticeSpacingSlack: 1.25,
    rigidityMaxMm: 0.5,
    seamGapMm: 0.1,
    triangleTolerance: 0.01,
    jointMissMm: 1,
    limbOwnership: 0.9,
    kneeBackwardMetres: 0.005,
    colliderRadiusMinMetres: 0.02,
    colliderRadiusMaxMetres: 0.35,
    latticeBindMillimetres: 0.5,
    latticeStretchRatio: 1.1,
    sizeToleranceMetres: 0.01,
    sizeToleranceFraction: 0.005,
    minimumNormalDetail: 0.02,
    embedFacingDegrees: 30,
    openEdgeFraction: 0.02,
    alphaCutoffTolerance: 1e-4,
    farMaterialAreaLoss: 0.1,
    wallRunFaceAreaSquareMetres: 1,
    wallRunNormalSpreadDegrees: 5,
    wallRunCreaseDegrees: 30,
    wallRunAreaQuantile: 0.9,
    supportGapMetres: 0.1,
    spanClearanceToleranceMetres: 0.001,
};

interface IGarmentMeasurements {
    rimVertices: number;
    mantleVertices: number;
    drapeVertices: number;
    detachedNodes: number;
    maxDrapeArmShare: number;
    liftMm: number;
    liftSamples: number;
    latticeNodes: number;
    nodeSpacingMm: number;
    uncoveredVertices: number;
    bandStretch: number;
    bandStretchRigid: number;
}

interface IPhysicsMeasurements {
    bodies: number;
    latticeBones: number;
    bodyNodes: Record<string, number>;
    colliders: number;
    colliderRadiusMin: number;
    colliderRadiusMax: number;
    clothVertices: number;
    strayLatticeInfluences: number;
    seamNodes: number;
    seamWeightMismatches: number;
    garment?: IGarmentMeasurements;
}

interface ICharacterMeasurements {
    triangles: number;
    jointMissMm: number;
    limbOwnership: Record<string, number>;
    poses: number;
    rigidity: Record<string, { maxMm: number; rmsMm: number }>;
    seamGapMm: number;
    stretch: Record<string, { worst: number; mean: number }>;
    edges: { total: number; over3: number; over5: number; propBoundary: number };
    physics?: IPhysicsMeasurements;
}

interface IModelMeasurements {
    triangles: number;
    boundsMetres: IBoundsMetres;
    uvRange: { min: readonly number[]; max: readonly number[] };
    materialTriangles: Record<string, number>;
    sharedMaterial: string | null;
    normalDetail: number | null;
    openEdgeMetres: number;
    facingDegrees: number;
    alphaCutoffs: Record<string, number | null>;
}

interface IKitModuleMeasurements {
    triangles: number;
    boundsMetres: IBoundsMetres;
    sockets: readonly { name: string; at: Vector3Tuple }[];
    faces?: readonly (readonly [number, number, number, number])[];
}

interface IKitMeasurements extends IModelMeasurements {
    modules: Record<string, IKitModuleMeasurements>;
}

export interface IExpectedSize {
    node: string | null;
    heightMetres: number;
    boundsMetres: IBoundsMetres | null;
}

interface IWallSide {
    areaSquareMetres: number;
    spreadDegrees: number;
}

export class Findings extends Array<string> {
    failIf(condition: boolean, message: string): void {
        if (condition) this.push(message);
    }
}

export abstract class BuildValidator<TRecipe extends IBuildRecipe, TMeasurements = unknown> {
    protected static readonly MEASUREMENTS_FILE = "validation/measurements.json";

    readonly reads: readonly string[] = [BuildValidator.MEASUREMENTS_FILE];

    validate(build: AssetBuild<TRecipe>): void {
        build.assertHasFiles(this.reads, "validation");
        const measurements = build.readJson<TMeasurements>(BuildValidator.MEASUREMENTS_FILE);
        const failures = this.findFailures(build, measurements);
        console.log(`  images: ${build.file("validation")}`);
        if (failures.length > 0)
            throw new Error(`Validation failed:\n  - ${failures.join("\n  - ")}`);
        console.log(
            "Validation passed: look at every image in the validation folder before showing anyone"
        );
    }

    protected static checkTriangles(
        budget: number,
        triangles: number,
        mode: "exact" | "atMost",
        failures: Findings
    ): void {
        console.log(`  ${triangles} triangles (budget ${budget})`);
        if (mode === "exact")
            failures.failIf(
                Math.abs(triangles - budget) / budget > VALIDATION_LIMITS.triangleTolerance,
                `${triangles} triangles, config asks for ${budget}`
            );
        else
            failures.failIf(
                triangles > budget,
                `${triangles} triangles, over the budget of ${budget}`
            );
    }

    abstract expectedSizes(recipe: TRecipe): readonly IExpectedSize[];

    protected tilesUvs(_recipe: TRecipe): boolean {
        return false;
    }

    protected abstract findFailures(
        build: AssetBuild<TRecipe>,
        measurements: TMeasurements
    ): string[];
}

abstract class StaticValidator<
    TRecipe extends IBuildRecipe,
    TMeasurements extends IModelMeasurements,
> extends BuildValidator<TRecipe, TMeasurements> {
    protected findFailures(build: AssetBuild<TRecipe>, measurements: TMeasurements): string[] {
        const failures = new Findings();
        console.log(`\nValidating ${build.recipe.name}`);
        this.checkShape(build.recipe, measurements, failures);
        for (const size of this.expectedSizes(build.recipe)) {
            const label = size.node ?? build.recipe.name;
            const measured = this.measuredBounds(measurements, size.node);
            if (measured) checkSize(size, measured, label, failures);
            else failures.push(`${label} was not measured`);
        }
        const { min, max } = measurements.uvRange;
        console.log(`  UVs ${min.join(", ")} to ${max.join(", ")}`);
        failures.failIf(
            !this.tilesUvs(build.recipe) &&
                (min.some((value) => value < 0) || max.some((value) => value > 1)),
            `UVs reach ${min.join(", ")} to ${max.join(", ")}, outside 0 to 1`
        );
        for (const [material, triangles] of Object.entries(measurements.materialTriangles))
            console.log(`  material ${material || "(none)"}: ${triangles} triangles`);
        return failures;
    }

    protected abstract checkShape(
        recipe: TRecipe,
        measurements: TMeasurements,
        failures: Findings
    ): void;

    protected abstract measuredBounds(
        measurements: TMeasurements,
        node: string | null
    ): IBoundsMetres | null;
}

export class ModelValidator<
    TRecipe extends IResolvedImportedRecipe = IResolvedImportedRecipe,
> extends StaticValidator<TRecipe, IModelMeasurements> {
    expectedSizes(recipe: TRecipe): readonly IExpectedSize[] {
        return recipe.heightMetres === null
            ? []
            : [{ node: null, heightMetres: recipe.heightMetres, boundsMetres: null }];
    }

    protected checkShape(
        recipe: TRecipe,
        measurements: IModelMeasurements,
        failures: Findings
    ): void {
        BuildValidator.checkTriangles(recipe.triangles, measurements.triangles, "atMost", failures);
    }

    protected measuredBounds(measurements: IModelMeasurements): IBoundsMetres {
        return measurements.boundsMetres;
    }
}

export class SculptValidator<
    TRecipe extends IResolvedImportedRecipe & { extras: Readonly<IStaticPieceExtras> } =
        IResolvedSculptRecipe,
> extends ModelValidator<TRecipe> {
    protected override checkShape(
        recipe: TRecipe,
        measurements: IModelMeasurements,
        failures: Findings
    ): void {
        super.checkShape(recipe, measurements, failures);
        const { openEdgeMetres, facingDegrees, boundsMetres } = measurements;
        const closedLimit =
            VALIDATION_LIMITS.openEdgeFraction * Math.max(...extentsOf(boundsMetres));
        const open = openEdgeMetres > closedLimit;
        console.log(
            `  open edges ${openEdgeMetres} m (closed up to ${closedLimit.toFixed(3)} m), facing ${facingDegrees} degrees from +Z`
        );
        if (!recipe.extras.embedOnly) {
            failures.failIf(
                open,
                `${openEdgeMetres} m of open edges: mark the recipe embedOnly or pick a closed source`
            );
            return;
        }
        failures.failIf(!open, "marked embedOnly but the mesh is closed: set embedOnly to false");
        failures.failIf(
            Math.abs(facingDegrees) > VALIDATION_LIMITS.embedFacingDegrees,
            `an embedOnly front faces ${facingDegrees} degrees from +Z (limit ${VALIDATION_LIMITS.embedFacingDegrees}): set facingYawDegrees to ${-facingDegrees}`
        );
    }
}

export class ScanValidator extends SculptValidator<IResolvedScanRecipe> {
    protected override checkShape(
        recipe: IResolvedScanRecipe,
        measurements: IModelMeasurements,
        failures: Findings
    ): void {
        super.checkShape(recipe, measurements, failures);
        const { normalDetail, sharedMaterial } = measurements;
        console.log(`  normal detail ${normalDetail}, shared material ${sharedMaterial}`);
        failures.failIf(
            normalDetail === null || normalDetail < VALIDATION_LIMITS.minimumNormalDetail,
            `normal map detail ${normalDetail} is below ${VALIDATION_LIMITS.minimumNormalDetail}: the bake came out flat`
        );
        failures.failIf(
            sharedMaterial !== recipe.sharedMaterial,
            `material carries shared material ${sharedMaterial}, recipe asks for ${recipe.sharedMaterial}`
        );
    }
}

export class KitValidator extends StaticValidator<IResolvedKitRecipe, IKitMeasurements> {
    protected override tilesUvs(recipe: IResolvedKitRecipe): boolean {
        return Object.values(recipe.materials).every((material) => material.kind === "tiled");
    }

    private static wallSides(
        faces: IKitModuleMeasurements["faces"],
        areaScale: number
    ): IWallSide[] {
        const maximumTilt = Math.sin(
            MathUtils.degToRad(VALIDATION_LIMITS.wallRunNormalSpreadDegrees)
        );
        const crease = Math.cos(MathUtils.degToRad(VALIDATION_LIMITS.wallRunCreaseDegrees));
        let remaining: { normal: Vector3; area: number }[] = [];
        for (const [x, y, z, area] of faces ?? [])
            if (Math.abs(y) <= maximumTilt)
                remaining.push({ normal: new Vector3(x, y, z), area: area * areaScale });
        const sides: IWallSide[] = [];
        const mean = new Vector3();
        while (remaining.length > 0) {
            const seed = remaining.reduce((largest, face) =>
                face.area > largest.area ? face : largest
            );
            const side: typeof remaining = [];
            const rest: typeof remaining = [];
            for (const face of remaining)
                (face.normal.dot(seed.normal) >= crease ? side : rest).push(face);
            remaining = rest;
            mean.set(0, 0, 0);
            let area = 0;
            for (const face of side) {
                mean.addScaledVector(face.normal, face.area);
                area += face.area;
            }
            mean.normalize();
            let covered = 0;
            const quantileAngle = side
                .map((face) => ({ angle: face.normal.angleTo(mean), area: face.area }))
                .sort((first, second) => first.angle - second.angle)
                .find(
                    (face) => (covered += face.area) >= area * VALIDATION_LIMITS.wallRunAreaQuantile
                )!.angle;
            sides.push({
                areaSquareMetres: area,
                spreadDegrees: 2 * MathUtils.radToDeg(quantileAngle),
            });
        }
        return sides;
    }

    static unsupportedParts(parts: readonly IKitPartBounds[]): IKitPartBounds[] {
        const gap = VALIDATION_LIMITS.supportGapMetres;
        const boxes = parts.map(({ min, max }) =>
            new Box3(new Vector3(...min), new Vector3(...max)).expandByScalar(gap / 2)
        );
        const supported = parts.map(({ min }) => min[1] <= gap);
        const reached = supported.flatMap((isGrounded, index) => (isGrounded ? [index] : []));
        while (reached.length > 0) {
            const box = boxes[reached.pop() ?? 0];
            boxes.forEach((other, index) => {
                if (supported[index] || !other.intersectsBox(box)) return;
                supported[index] = true;
                reached.push(index);
            });
        }
        return parts.filter((_, index) => !supported[index]);
    }

    expectedSizes(recipe: IResolvedKitRecipe): readonly IExpectedSize[] {
        return recipe.modules.map((kitModule) => ({
            node: kitModule.name,
            heightMetres: extentsOf(kitModule.boundsMetres)[1],
            boundsMetres: kitModule.boundsMetres,
        }));
    }

    protected checkShape(
        recipe: IResolvedKitRecipe,
        measurements: IKitMeasurements,
        failures: Findings
    ): void {
        for (const [slot, material] of Object.entries(recipe.materials)) {
            if (material.kind !== "cutout") continue;
            const cutoff = measurements.alphaCutoffs[slot] ?? null;
            console.log(`  material ${slot}: alpha cutoff ${cutoff}`);
            failures.failIf(
                cutoff === null ||
                    Math.abs(cutoff - material.alphaCutoff) >
                        VALIDATION_LIMITS.alphaCutoffTolerance,
                `material ${slot} exports alpha cutoff ${cutoff}, recipe asks for ${material.alphaCutoff}: its cards would render solid`
            );
        }
        for (const kitModule of recipe.modules) {
            for (const part of KitValidator.unsupportedParts(kitModule.partBoundsMetres))
                failures.push(
                    `module ${kitModule.name}: a ${part.material} part rests on nothing, its lowest point is ${part.min[1].toFixed(2)} m up`
                );
            const measured = measurements.modules[kitModule.name];
            if (!measured) continue;
            const { min, max } = measured.boundsMetres;
            console.log(
                `  module ${kitModule.name}: ${min.join(", ")} to ${max.join(", ")} m, ${measured.sockets.length} sockets`
            );
            BuildValidator.checkTriangles(
                recipe.trianglesPerModule,
                measured.triangles,
                "atMost",
                failures
            );
            const bounds = new Box3(new Vector3(...min), new Vector3(...max));
            for (const socket of measured.sockets)
                failures.failIf(
                    !bounds.containsPoint(new Vector3(...socket.at)),
                    `module ${kitModule.name}: socket ${socket.name} at ${socket.at.join(", ")} sits outside the module`
                );
            if (!kitModule.extras.wallRunnable) continue;
            const sides = KitValidator.wallSides(measured.faces, recipe.propScale ** 2);
            const widest = sides.reduce<IWallSide | null>(
                (best, side) =>
                    !best || side.areaSquareMetres > best.areaSquareMetres ? side : best,
                null
            );
            console.log(
                `  module ${kitModule.name} widest wall ${widest?.areaSquareMetres.toFixed(2) ?? 0} m², spread ${widest?.spreadDegrees.toFixed(1) ?? "-"}°`
            );
            failures.failIf(
                !sides.some(
                    (side) =>
                        side.areaSquareMetres >= VALIDATION_LIMITS.wallRunFaceAreaSquareMetres &&
                        side.spreadDegrees <= VALIDATION_LIMITS.wallRunNormalSpreadDegrees
                ),
                `module ${kitModule.name} is wall-runnable but has no vertical wall of ${VALIDATION_LIMITS.wallRunFaceAreaSquareMetres} m² flat within ${VALIDATION_LIMITS.wallRunNormalSpreadDegrees}°`
            );
        }
    }

    protected measuredBounds(
        measurements: IKitMeasurements,
        node: string | null
    ): IBoundsMetres | null {
        return node === null
            ? measurements.boundsMetres
            : (measurements.modules[node]?.boundsMetres ?? null);
    }
}

export class CharacterValidator extends BuildValidator<
    IResolvedCharacterRecipe,
    ICharacterMeasurements
> {
    private static readonly heightFactor = (recipe: IResolvedCharacterRecipe): number =>
        recipe.heightMetres / recipe.referenceHeightMetres;

    override readonly reads = [BuildValidator.MEASUREMENTS_FILE, "joints.json", "detection.json"];

    expectedSizes(recipe: IResolvedCharacterRecipe): readonly IExpectedSize[] {
        return [{ node: null, heightMetres: recipe.heightMetres, boundsMetres: null }];
    }

    protected findFailures(
        build: AssetBuild<IResolvedCharacterRecipe>,
        measurements: ICharacterMeasurements
    ): string[] {
        console.log(`\nValidating over ${measurements.poses} poses`);
        const failures = new Findings();
        this.checkJoints(build, failures);
        this.checkSkeletonFit(measurements, failures);
        this.checkRigidity(measurements, failures);
        this.checkStretch(measurements, failures);
        this.checkPhysics(build, measurements, failures);
        BuildValidator.checkTriangles(
            build.recipe.triangles,
            measurements.triangles,
            "exact",
            failures
        );
        return failures;
    }

    private kneeBendMetres(
        positions: CharacterJoints,
        skeleton: ISkeletonDescriptor,
        side: SkeletonSide
    ): number {
        const [hipBone, kneeBone, ankleBone] = skeleton.bones.legs[side];
        const hip = new Vector3(...positions[hipBone!]);
        const knee = new Vector3(...positions[kneeBone!]);
        const ankle = new Vector3(...positions[ankleBone!]);
        const ball = new Vector3(...positions[skeleton.bones.feet[side][1]]);

        const legAxis = ankle.clone().sub(hip).normalize();
        const toesForward = new Vector3(ball.x - ankle.x, ball.y - ankle.y, 0);
        toesForward.addScaledVector(legAxis, -toesForward.dot(legAxis));
        const kneeOffset = knee.clone().sub(hip);
        kneeOffset.addScaledVector(legAxis, -kneeOffset.dot(legAxis));
        return kneeOffset.dot(toesForward) / toesForward.length();
    }

    private checkJoints(build: AssetBuild<IResolvedCharacterRecipe>, failures: Findings): void {
        const confirmed = build.recipe.joints;
        if (!confirmed) {
            failures.push(
                "joints are measured but not confirmed: check them against the character and add " +
                    "them to tools/assets/AssetManifest.ts"
            );
            return;
        }

        const built = build.readJson<{ final: Record<string, readonly number[]> }>(
            "joints.json"
        ).final;
        const stale = Object.entries(confirmed.positions)
            .filter(([name, position]) =>
                position.some((value, axis) => built[name]?.[axis] !== value)
            )
            .map(([name]) => name);
        failures.failIf(
            stale.length > 0,
            `the build used joints other than the confirmed ones (${stale.join(", ")}): re-run from the joints stage`
        );
        const skeleton = build.recipe.skeletonDescriptor;
        for (const side of ["left", "right"] as const) {
            const bend = this.kneeBendMetres(confirmed.positions, skeleton, side);
            const kneeBone = skeleton.bones.legs[side][1];
            console.log(`  ${kneeBone} bends ${(bend * 100).toFixed(1)} cm toward the toes`);
            const kneeLimit =
                VALIDATION_LIMITS.kneeBackwardMetres *
                CharacterValidator.heightFactor(build.recipe);
            failures.failIf(
                !(bend >= -kneeLimit),
                `${kneeBone} bend is ${(bend * 100).toFixed(1)} cm toward the toes (limit ${(-kneeLimit * 100).toFixed(1)} cm): the leg is bent backwards or its joints are degenerate`
            );
        }
    }

    private checkSkeletonFit(measurements: ICharacterMeasurements, failures: Findings): void {
        console.log(`  joint miss ${measurements.jointMissMm.toFixed(3)} mm`);
        failures.failIf(
            measurements.jointMissMm > VALIDATION_LIMITS.jointMissMm,
            `the fitted skeleton misses its joints by ${measurements.jointMissMm} mm (limit ${VALIDATION_LIMITS.jointMissMm} mm)`
        );
        for (const [limb, share] of Object.entries(measurements.limbOwnership)) {
            console.log(`  limb ${limb.padEnd(6)} own-chain weight ${share.toFixed(3)}`);
            failures.failIf(
                share < VALIDATION_LIMITS.limbOwnership,
                `${limb} carries only ${share} of its weight on its own bones (limit ${VALIDATION_LIMITS.limbOwnership})`
            );
        }
    }

    private checkRigidity(measurements: ICharacterMeasurements, failures: Findings): void {
        for (const [group, { maxMm, rmsMm }] of Object.entries(measurements.rigidity)) {
            console.log(
                `  rigid ${group.padEnd(18)} max ${maxMm.toFixed(3)} mm  rms ${rmsMm.toFixed(3)} mm`
            );
            failures.failIf(
                maxMm > VALIDATION_LIMITS.rigidityMaxMm,
                `${group} deforms by ${maxMm} mm (limit ${VALIDATION_LIMITS.rigidityMaxMm} mm)`
            );
        }
        console.log(`  seam gap ${measurements.seamGapMm.toFixed(3)} mm`);
        failures.failIf(
            measurements.seamGapMm > VALIDATION_LIMITS.seamGapMm,
            `UV seams open by ${measurements.seamGapMm} mm (limit ${VALIDATION_LIMITS.seamGapMm} mm)`
        );
    }

    private checkStretch(measurements: ICharacterMeasurements, failures: Findings): void {
        for (const [region, { worst, mean }] of Object.entries(measurements.stretch))
            console.log(`  stretch ${region.padEnd(7)} worst x${worst}  mean x${mean}`);
        const { edges } = measurements;
        console.log(`  edges stretched >3x: ${edges.over3}, >5x: ${edges.over5} of ${edges.total}`);
        console.log(`  edges joining a prop to the body: ${edges.propBoundary}`);
        failures.failIf(
            edges.propBoundary > 0,
            `${edges.propBoundary} mesh edges join a rigid prop to the body: the prop is not detached`
        );
    }

    private checkPhysics(
        build: AssetBuild<IResolvedCharacterRecipe>,
        measurements: ICharacterMeasurements,
        failures: Findings
    ): void {
        const detected = build.readJson<IDetectionReport>("detection.json").physics;
        const expectedBodies = detected.length;
        if (expectedBodies === 0) return;
        const physics = measurements.physics;
        if (!physics) {
            failures.push("bodies were detected but measurements.json has no physics section");
            return;
        }

        console.log(
            `  physics ${physics.bodies} bodies, ${physics.latticeBones} lattice bones, ${physics.colliders} colliders, ` +
                `radius ${physics.colliderRadiusMin}-${physics.colliderRadiusMax} m`
        );
        failures.failIf(physics.clothVertices <= 0, "no vertex was labelled as physics cloth");
        failures.failIf(
            physics.strayLatticeInfluences > 0,
            `physics weights are inconsistent: ${physics.strayLatticeInfluences} non-cloth vertices use lattice bones`
        );
        console.log(
            `  cloth seam ${physics.seamNodes} nodes, ${physics.seamWeightMismatches} weighted unlike their body twin`
        );
        failures.failIf(
            physics.seamWeightMismatches > 0,
            `${physics.seamWeightMismatches} cloth seam nodes are weighted unlike their body twin, so the seam opens when the cloth moves`
        );
        const builtNodes = Object.values(physics.bodyNodes).reduce((sum, nodes) => sum + nodes, 0);
        failures.failIf(
            physics.bodies !== expectedBodies || physics.latticeBones !== builtNodes,
            `physics built ${physics.bodies} bodies and ${physics.latticeBones} lattice bones, expected ${expectedBodies} bodies and ${builtNodes} nodes`
        );
        for (const body of detected)
            if (
                body.columns &&
                body.rows &&
                physics.bodyNodes[body.name] !== body.columns * body.rows
            )
                failures.push(
                    `${body.name} built ${physics.bodyNodes[body.name]} nodes, detection asks for ${body.columns * body.rows}`
                );
        const minimumRadius =
            VALIDATION_LIMITS.colliderRadiusMinMetres *
            CharacterValidator.heightFactor(build.recipe);
        const maximumRadius =
            VALIDATION_LIMITS.colliderRadiusMaxMetres *
            CharacterValidator.heightFactor(build.recipe);
        failures.failIf(
            physics.colliderRadiusMin < minimumRadius || physics.colliderRadiusMax > maximumRadius,
            `collider radii ${physics.colliderRadiusMin}-${physics.colliderRadiusMax} m are outside ${minimumRadius.toFixed(3)}-${maximumRadius.toFixed(3)} m`
        );
        this.checkGarment(build, physics, failures);
    }

    private checkGarment(
        build: AssetBuild<IResolvedCharacterRecipe>,
        physics: IPhysicsMeasurements,
        failures: Findings
    ): void {
        const garment = physics.garment;
        if (!garment) return;
        const { rig, weights } = build.recipe.tuning;
        const liftLimitMm =
            weights.garmentLiftLimit *
            MILLIMETRES_PER_METRE *
            CharacterValidator.heightFactor(build.recipe);
        console.log(
            `  garment rim ${garment.rimVertices}, mantle ${garment.mantleVertices}, drape ${garment.drapeVertices}, ` +
                `detached ${garment.detachedNodes}, drape arm share ${garment.maxDrapeArmShare}, lift ${garment.liftMm} mm (${garment.liftSamples} drape nodes measured)`
        );
        failures.failIf(
            garment.rimVertices > 0 && garment.mantleVertices === 0,
            "the garment covers an open body rim but no vertex was classed as mantle"
        );
        failures.failIf(
            garment.detachedNodes > 0,
            `${garment.detachedNodes} garment nodes are split from the body, so the rim can open`
        );
        failures.failIf(
            garment.maxDrapeArmShare > rig.garmentArmShare + VALIDATION_LIMITS.garmentArmShareSlack,
            `drape arm share ${garment.maxDrapeArmShare} is above the cap ${rig.garmentArmShare}`
        );
        failures.failIf(
            garment.liftMm > liftLimitMm,
            `the drape lifts ${garment.liftMm} mm off the body (limit ${liftLimitMm.toFixed(1)} mm)`
        );
        const scale = CharacterValidator.heightFactor(build.recipe);
        const spacingLimitMm =
            build.recipe.tuning.physics.nodeSpacing *
            VALIDATION_LIMITS.latticeSpacingSlack *
            MILLIMETRES_PER_METRE *
            scale;
        console.log(
            `  garment lattice ${garment.latticeNodes} nodes, spacing ${garment.nodeSpacingMm} mm, ` +
                `uncovered ${garment.uncoveredVertices}, blend band stretch ${garment.bandStretch}x (rigid ${garment.bandStretchRigid}x)`
        );
        failures.failIf(
            garment.nodeSpacingMm > spacingLimitMm,
            `garment nodes are ${garment.nodeSpacingMm} mm apart (limit ${spacingLimitMm.toFixed(0)} mm)`
        );
        failures.failIf(
            garment.uncoveredVertices > 0,
            `${garment.uncoveredVertices} driven garment vertices fall outside the lattice`
        );
        failures.failIf(
            garment.bandStretch > garment.bandStretchRigid * VALIDATION_LIMITS.latticeStretchRatio,
            `the lattice stretches the blend band ${garment.bandStretch}x against ${garment.bandStretchRigid}x for the rigid skin (allowed ratio ${VALIDATION_LIMITS.latticeStretchRatio}), which shows as a hinge`
        );
    }
}

export const extentsOf = (bounds: IBoundsMetres): Vector3Tuple => [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
];

export const boundsDrift = (first: IBoundsMetres, second: IBoundsMetres): number =>
    Math.max(
        Math.abs(first.min[0] - second.min[0]),
        Math.abs(first.min[1] - second.min[1]),
        Math.abs(first.min[2] - second.min[2]),
        Math.abs(first.max[0] - second.max[0]),
        Math.abs(first.max[1] - second.max[1]),
        Math.abs(first.max[2] - second.max[2])
    );

export const scaleBounds = (bounds: IBoundsMetres, factor: number): IBoundsMetres => ({
    min: [bounds.min[0] * factor, bounds.min[1] * factor, bounds.min[2] * factor],
    max: [bounds.max[0] * factor, bounds.max[1] * factor, bounds.max[2] * factor],
});

export const scaleExpectedSize = (expected: IExpectedSize, factor: number): IExpectedSize => ({
    node: expected.node,
    heightMetres: expected.heightMetres * factor,
    boundsMetres: expected.boundsMetres && scaleBounds(expected.boundsMetres, factor),
});

export const checkSize = (
    expected: IExpectedSize,
    measured: IBoundsMetres,
    label: string,
    failures: Findings
): void => {
    const height = extentsOf(measured)[1];
    const base = measured.min[1];
    const tolerance = sizeToleranceFor(
        expected.boundsMetres ? extentsOf(expected.boundsMetres) : [expected.heightMetres]
    );
    console.log(
        `  ${label}: height ${height.toFixed(3)} m (recipe ${expected.heightMetres.toFixed(3)} m), base ${base.toFixed(3)} m`
    );
    failures.failIf(
        Math.abs(height - expected.heightMetres) > tolerance,
        `${label}: height ${height.toFixed(3)} m differs from the recipe's ${expected.heightMetres.toFixed(3)} m by more than ${tolerance.toFixed(3)} m (wrong scale or not +Y up)`
    );
    failures.failIf(
        Math.abs(base) > tolerance,
        `${label}: base sits at y = ${base.toFixed(3)} m, not 0`
    );
    if (!expected.boundsMetres) return;
    const drift = boundsDrift(measured, expected.boundsMetres);
    failures.failIf(
        drift > tolerance,
        `${label}: bounds sit ${drift.toFixed(3)} m from the recipe's (tolerance ${tolerance.toFixed(3)} m)`
    );
};

const sizeToleranceFor = (extentsMetres: readonly number[]): number =>
    Math.max(
        VALIDATION_LIMITS.sizeToleranceMetres,
        VALIDATION_LIMITS.sizeToleranceFraction * Math.max(...extentsMetres)
    );
