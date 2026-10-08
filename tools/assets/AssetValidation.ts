import { Vector3 } from "three";
import type { ISkeletonDescriptor, SkeletonSide } from "@/constants/characters";
import type { AssetBuild, IBuildRecipe, IDetectionReport } from "./AssetBuilds";
import type { CharacterJoints, IResolvedCharacterRecipe } from "./AssetManifest";

export const VALIDATION_LIMITS = {
    rigidityMaxMm: 0.5,
    seamGapMm: 0.1,
    triangleTolerance: 0.01,
    jointMissMm: 1,
    limbOwnership: 0.9,
    kneeBackwardMetres: 0.005,
    colliderRadiusMinMetres: 0.02,
    colliderRadiusMaxMetres: 0.35,
    latticeBindMillimetres: 0.5,
};

interface IGarmentMeasurements {
    rimVertices: number;
    mantleVertices: number;
    drapeVertices: number;
    detachedNodes: number;
    maxDrapeArmShare: number;
    liftMm: number;
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

export class Findings extends Array<string> {
    failIf(condition: boolean, message: string): void {
        if (condition) this.push(message);
    }
}

export abstract class BuildValidator<TRecipe extends IBuildRecipe, TMeasurements = unknown> {
    validate(build: AssetBuild<TRecipe>): void {
        const measurements = build.readJson<TMeasurements>("validation", "measurements.json");
        const failures = this.findFailures(build, measurements);
        console.log(`  images: ${build.file("validation")}`);
        if (failures.length > 0)
            throw new Error(`Validation failed:\n  - ${failures.join("\n  - ")}`);
        console.log(
            "Validation passed: look at every image in the validation folder before showing anyone"
        );
    }

    protected abstract findFailures(
        build: AssetBuild<TRecipe>,
        measurements: TMeasurements
    ): string[];
}

const heightFactor = (recipe: IResolvedCharacterRecipe): number =>
    recipe.heightMetres / recipe.referenceHeightMetres;

export class CharacterValidator extends BuildValidator<
    IResolvedCharacterRecipe,
    ICharacterMeasurements
> {
    protected findFailures(
        build: AssetBuild<IResolvedCharacterRecipe>,
        measurements: ICharacterMeasurements
    ): string[] {
        console.log(`\nValidating over ${measurements.poses} poses`);
        return [
            ...this.checkJoints(build),
            ...this.checkSkeletonFit(measurements),
            ...this.checkRigidity(measurements),
            ...this.checkStretch(measurements),
            ...this.checkPhysics(build, measurements),
            ...this.checkTriangles(build.recipe, measurements),
        ];
    }

    private kneeBendMetres(
        positions: CharacterJoints,
        skeleton: ISkeletonDescriptor,
        side: SkeletonSide
    ): number {
        const [hipBone, kneeBone, ankleBone] = skeleton.bones.legs[side];
        const hip = new Vector3(...positions[hipBone!]!);
        const knee = new Vector3(...positions[kneeBone!]!);
        const ankle = new Vector3(...positions[ankleBone!]!);
        const ball = new Vector3(...positions[skeleton.bones.feet[side][1]!]!);

        const legAxis = ankle.clone().sub(hip).normalize();
        const toesForward = new Vector3(ball.x - ankle.x, ball.y - ankle.y, 0);
        toesForward.addScaledVector(legAxis, -toesForward.dot(legAxis));
        const kneeOffset = knee.clone().sub(hip);
        kneeOffset.addScaledVector(legAxis, -kneeOffset.dot(legAxis));
        return kneeOffset.dot(toesForward) / toesForward.length();
    }

    private checkJoints(build: AssetBuild<IResolvedCharacterRecipe>): string[] {
        const confirmed = build.recipe.joints;
        if (!confirmed)
            return [
                "joints are measured but not confirmed: check them against the character and add " +
                    "them to tools/assets/AssetManifest.ts",
            ];

        const failures = new Findings();
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
            const kneeLimit = VALIDATION_LIMITS.kneeBackwardMetres * heightFactor(build.recipe);
            failures.failIf(
                !(bend >= -kneeLimit),
                `${kneeBone} bend is ${(bend * 100).toFixed(1)} cm toward the toes (limit ${(-kneeLimit * 100).toFixed(1)} cm): the leg is bent backwards or its joints are degenerate`
            );
        }
        return failures;
    }

    private checkSkeletonFit(measurements: ICharacterMeasurements): string[] {
        const failures = new Findings();
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
        return failures;
    }

    private checkRigidity(measurements: ICharacterMeasurements): string[] {
        const failures = new Findings();
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
        return failures;
    }

    private checkStretch(measurements: ICharacterMeasurements): string[] {
        for (const [region, { worst, mean }] of Object.entries(measurements.stretch))
            console.log(`  stretch ${region.padEnd(7)} worst x${worst}  mean x${mean}`);
        const { edges } = measurements;
        console.log(`  edges stretched >3x: ${edges.over3}, >5x: ${edges.over5} of ${edges.total}`);
        console.log(`  edges joining a prop to the body: ${edges.propBoundary}`);
        return edges.propBoundary > 0
            ? [
                  `${edges.propBoundary} mesh edges join a rigid prop to the body: the prop is not detached`,
              ]
            : [];
    }

    private checkPhysics(
        build: AssetBuild<IResolvedCharacterRecipe>,
        measurements: ICharacterMeasurements
    ): string[] {
        const detected = build.readJson<IDetectionReport>("detection.json").physics;
        const expectedBodies = detected.length;
        if (expectedBodies === 0) return [];
        const physics = measurements.physics;
        if (!physics) return ["bodies were detected but measurements.json has no physics section"];

        const failures = new Findings();
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
            VALIDATION_LIMITS.colliderRadiusMinMetres * heightFactor(build.recipe);
        const maximumRadius =
            VALIDATION_LIMITS.colliderRadiusMaxMetres * heightFactor(build.recipe);
        failures.failIf(
            physics.colliderRadiusMin < minimumRadius || physics.colliderRadiusMax > maximumRadius,
            `collider radii ${physics.colliderRadiusMin}-${physics.colliderRadiusMax} m are outside ${minimumRadius.toFixed(3)}-${maximumRadius.toFixed(3)} m`
        );
        failures.push(...this.checkGarment(build, physics));
        return failures;
    }

    private checkGarment(
        build: AssetBuild<IResolvedCharacterRecipe>,
        physics: IPhysicsMeasurements
    ): string[] {
        const garment = physics.garment;
        if (!garment) return [];
        const { rig, weights } = build.recipe.tuning;
        const liftLimitMm = weights.garmentLiftLimit * 1000 * heightFactor(build.recipe);
        console.log(
            `  garment rim ${garment.rimVertices}, mantle ${garment.mantleVertices}, drape ${garment.drapeVertices}, ` +
                `detached ${garment.detachedNodes}, drape arm share ${garment.maxDrapeArmShare}, lift ${garment.liftMm} mm`
        );
        const failures = new Findings();
        failures.failIf(
            garment.rimVertices > 0 && garment.mantleVertices === 0,
            "the garment covers an open body rim but no vertex was classed as mantle"
        );
        failures.failIf(
            garment.detachedNodes > 0,
            `${garment.detachedNodes} garment nodes are split from the body, so the rim can open`
        );
        failures.failIf(
            garment.maxDrapeArmShare > rig.garmentArmShare + 0.02,
            `drape arm share ${garment.maxDrapeArmShare} is above the cap ${rig.garmentArmShare}`
        );
        failures.failIf(
            garment.liftMm > liftLimitMm,
            `the drape lifts ${garment.liftMm} mm off the body (limit ${liftLimitMm.toFixed(1)} mm)`
        );
        const scale = heightFactor(build.recipe);
        const spacingLimitMm = build.recipe.tuning.physics.nodeSpacing * 1.25 * 1000 * scale;
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
            garment.bandStretch > garment.bandStretchRigid * weights.latticeStretchRatio,
            `the lattice stretches the blend band ${garment.bandStretch}x against ${garment.bandStretchRigid}x for the rigid skin (allowed ratio ${weights.latticeStretchRatio}), which shows as a hinge`
        );
        return failures;
    }

    private checkTriangles(
        recipe: IResolvedCharacterRecipe,
        measurements: ICharacterMeasurements
    ): string[] {
        const drift = Math.abs(measurements.triangles - recipe.triangles) / recipe.triangles;
        return drift > VALIDATION_LIMITS.triangleTolerance
            ? [`${measurements.triangles} triangles, config asks for ${recipe.triangles}`]
            : [];
    }
}
