import type { IThemeProp } from "@/types/theme";
import type { IWaterCourse } from "@/world/water/WaterCourse";
import { forceProp, pickSpecies, type IFieldContext } from "@/world/props/PropPlacement";
import type { ISpeciesByLayer } from "@/world/props/PropField";
import { WATER_EDGE } from "@/constants/placement";
import { scaleBetween, FULL_TURN } from "@/lib/helpers";

interface ISpringStone {
    cross: number;
    back: number;
    scale: number;
}

const SPRING_RIM_STONES: ISpringStone[] = [
    { cross: 0.0, back: 0.1, scale: 2.8 },
    { cross: -0.35, back: 0.0, scale: 2.6 },
    { cross: 0.35, back: 0.0, scale: 2.6 },
    { cross: -0.7, back: -0.12, scale: 2.5 },
    { cross: 0.7, back: -0.12, scale: 2.5 },
    { cross: -1.05, back: -0.3, scale: 2.3 },
    { cross: 1.05, back: -0.3, scale: 2.3 },
    { cross: -1.35, back: -0.5, scale: 2.2 },
    { cross: 1.35, back: -0.5, scale: 2.2 },
];

const SPRING_BACKWALL_STONES: ISpringStone[] = [
    { cross: 0.0, back: 0.8, scale: 3.6 },
    { cross: -0.4, back: 0.75, scale: 3.4 },
    { cross: 0.4, back: 0.75, scale: 3.4 },
    { cross: -0.85, back: 0.6, scale: 3.2 },
    { cross: 0.85, back: 0.6, scale: 3.2 },
    { cross: -0.2, back: 1.25, scale: 3.8 },
    { cross: 0.2, back: 1.25, scale: 3.8 },
    { cross: -0.6, back: 1.15, scale: 3.5 },
    { cross: 0.6, back: 1.15, scale: 3.5 },
    { cross: 0.0, back: 1.6, scale: 4.0 },
];

const ALL_SPRING_STONES = [...SPRING_RIM_STONES, ...SPRING_BACKWALL_STONES];

export function decorateWaterCourse(
    course: IWaterCourse,
    speciesByLayer: ISpeciesByLayer,
    field: IFieldContext
): void {
    if (course.points.length < 2) return;

    if (course.isMudhole) {
        decorateMudhole(course, speciesByLayer, field);
        return;
    }

    decorateSpring(course, speciesByLayer, field);
    decorateOutflow(course, speciesByLayer, field);
}

function decorateSpring(
    course: IWaterCourse,
    speciesByLayer: ISpeciesByLayer,
    field: IFieldContext
): void {
    const source = course.points[0]!;
    const frame = courseFrameAt(course, 0);
    const reach = Math.max(source.halfWidth, WATER_EDGE.minimumSpringRadius);
    const boulders = speciesByLayer.rock;

    if (boulders.length > 0)
        for (const stone of ALL_SPRING_STONES) {
            const boulder = pickSpecies(boulders, field.nextRandom);
            if (!boulder) continue;

            forceProp(
                boulder,
                source.x +
                    frame.acrossX * (reach * stone.cross) -
                    frame.alongX * (reach * stone.back),
                source.z +
                    frame.acrossZ * (reach * stone.cross) -
                    frame.alongZ * (reach * stone.back),
                stone.scale * jitterAround(WATER_EDGE.stoneScaleJitter, field),
                WATER_EDGE.stoneSink,
                field
            );
        }

    const bankPlants = riverbankFoliage(speciesByLayer);
    if (bankPlants.length === 0) return;

    for (let index = 0; index < WATER_EDGE.springPlantCount; index += 1) {
        const plant = pickSpecies(bankPlants, field.nextRandom);
        if (!plant) continue;

        const cross = (field.nextRandom() - 0.5) * WATER_EDGE.springPlantCrossSpread;
        const back = scaleBetween(WATER_EDGE.springPlantBackRange, field.nextRandom());

        forceProp(
            plant,
            source.x + frame.acrossX * (reach * cross) - frame.alongX * (reach * back),
            source.z + frame.acrossZ * (reach * cross) - frame.alongZ * (reach * back),
            scaleBetween(WATER_EDGE.plantScaleRange, field.nextRandom()),
            0,
            field
        );
    }
}

function decorateOutflow(
    course: IWaterCourse,
    speciesByLayer: ISpeciesByLayer,
    field: IFieldContext
): void {
    const boulders = speciesByLayer.rock;
    if (boulders.length === 0) return;

    const points = course.points;
    const mouth = points[points.length - 1]!;
    const frame = courseFrameAt(course, points.length - 1);
    const offset = mouth.halfWidth + WATER_EDGE.outflowStoneOffset;

    for (const side of [-1, 1]) {
        const boulder = pickSpecies(boulders, field.nextRandom);
        if (!boulder) continue;

        forceProp(
            boulder,
            mouth.x + frame.acrossX * offset * side,
            mouth.z + frame.acrossZ * offset * side,
            scaleBetween(WATER_EDGE.outflowStoneScaleRange, field.nextRandom()),
            WATER_EDGE.stoneSink,
            field
        );
    }
}

function decorateMudhole(
    course: IWaterCourse,
    speciesByLayer: ISpeciesByLayer,
    field: IFieldContext
): void {
    const points = course.points;
    const centre = points[Math.floor(points.length / 2)]!;
    const poolRadius = centre.halfWidth;
    const boulders = speciesByLayer.rock;
    const foliage = riverbankFoliage(speciesByLayer);

    for (let index = 0; index < WATER_EDGE.mudholeStoneCount; index += 1) {
        const boulder = pickSpecies(boulders, field.nextRandom);
        if (!boulder) continue;

        const angle =
            (index / WATER_EDGE.mudholeStoneCount) * FULL_TURN +
            (field.nextRandom() - 0.5) * WATER_EDGE.mudholeStoneAngleJitter;
        const distance =
            poolRadius + scaleBetween(WATER_EDGE.mudholeStoneOffsetRange, field.nextRandom());

        forceProp(
            boulder,
            centre.x + Math.cos(angle) * distance,
            centre.z + Math.sin(angle) * distance,
            scaleBetween(WATER_EDGE.mudholeStoneScaleRange, field.nextRandom()),
            WATER_EDGE.mudholeStoneSink,
            field
        );
    }

    for (let index = 0; index < WATER_EDGE.mudholePlantCount; index += 1) {
        const plant = pickSpecies(foliage, field.nextRandom);
        if (!plant) continue;

        const angle = field.nextRandom() * FULL_TURN;
        const distance =
            poolRadius + scaleBetween(WATER_EDGE.mudholePlantOffsetRange, field.nextRandom());

        forceProp(
            plant,
            centre.x + Math.cos(angle) * distance,
            centre.z + Math.sin(angle) * distance,
            scaleBetween(WATER_EDGE.plantScaleRange, field.nextRandom()),
            0,
            field
        );
    }

    if (poolRadius < WATER_EDGE.mudholeTreePoolRadius) return;

    const tree = pickSpecies(speciesByLayer.canopy, field.nextRandom);
    if (!tree) return;

    const angle = field.nextRandom() * FULL_TURN;
    const distance =
        poolRadius + scaleBetween(WATER_EDGE.mudholeTreeOffsetRange, field.nextRandom());

    forceProp(
        tree,
        centre.x + Math.cos(angle) * distance,
        centre.z + Math.sin(angle) * distance,
        scaleBetween(WATER_EDGE.mudholeTreeScaleRange, field.nextRandom()),
        0,
        field
    );
}

const isFlowering = (prop: IThemeProp): boolean => /flower/i.test(prop.modelPath);
const riverbankFoliage = (speciesByLayer: ISpeciesByLayer): IThemeProp[] => [
    ...speciesByLayer.groundcover.filter((prop) => !isFlowering(prop)),
    ...speciesByLayer.understory.filter((prop) => !isFlowering(prop)),
];

const jitterAround = (spread: number, field: IFieldContext): number =>
    1 - spread / 2 + field.nextRandom() * spread;

function courseFrameAt(course: IWaterCourse, pointIndex: number): ICourseFrame {
    const points = course.points;
    const isSource = pointIndex === 0;
    const spanEnd = isSource
        ? Math.min(pointIndex + WATER_EDGE.frameSpan, points.length - 1)
        : pointIndex;
    const spanStart = isSource ? pointIndex : Math.max(pointIndex - WATER_EDGE.frameSpan, 0);

    const fromPoint = points[spanStart]!;
    const toPoint = points[spanEnd]!;
    const travelX = toPoint.x - fromPoint.x;
    const travelZ = toPoint.z - fromPoint.z;
    const travelLength = Math.hypot(travelX, travelZ) || 1;

    const alongX = travelX / travelLength;
    const alongZ = travelZ / travelLength;

    return { alongX, alongZ, acrossX: -alongZ, acrossZ: alongX };
}

interface ICourseFrame {
    alongX: number;
    alongZ: number;
    acrossX: number;
    acrossZ: number;
}
