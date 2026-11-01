import type { IThemeProp, IWaterCourse, ISpeciesByLayer } from "@/types/world";
import { forceProp, type IPropScatterContext, scatterSpecies } from "@/world/props/PropPlacement";
import { WATER_EDGE } from "@/constants/placement";
import {
    valueInRange,
    FULL_TURN,
    pointAtAngle,
    randomOffset,
    pickRandomOrNull,
    segmentFrame,
} from "@/lib/helpers";
import type { ISegmentFrame } from "@/lib/helpers";

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

interface ISpringStone {
    cross: number;
    back: number;
    scale: number;
}

export function decorateWaterCourse(
    course: IWaterCourse,
    speciesByLayer: ISpeciesByLayer,
    scatter: IPropScatterContext
): void {
    if (course.points.length < 2) return;

    if (course.isMudhole) {
        decorateMudhole(course, speciesByLayer, scatter);
        return;
    }

    decorateSpring(course, speciesByLayer, scatter);
    decorateOutflow(course, speciesByLayer, scatter);
}

function decorateSpring(
    course: IWaterCourse,
    speciesByLayer: ISpeciesByLayer,
    scatter: IPropScatterContext
): void {
    const source = course.points[0];
    const frame = courseFrameAt(course, 0);
    const reach = Math.max(source.halfWidth, WATER_EDGE.minimumSpringRadius);
    const boulders = speciesByLayer.rock;

    if (boulders.length > 0)
        for (const stone of ALL_SPRING_STONES) {
            const boulder = pickRandomOrNull(boulders, scatter.nextRandom);
            if (!boulder) continue;

            forceProp(
                boulder,
                source.x +
                    frame.acrossX * (reach * stone.cross) -
                    frame.alongX * (reach * stone.back),
                source.z +
                    frame.acrossZ * (reach * stone.cross) -
                    frame.alongZ * (reach * stone.back),
                stone.scale *
                    (1 + randomOffset(scatter.nextRandom, WATER_EDGE.stoneScaleJitter / 2)),
                WATER_EDGE.stoneSink,
                scatter
            );
        }

    const bankPlants = riverbankFoliage(speciesByLayer);
    if (bankPlants.length === 0) return;

    scatterSpecies(bankPlants, WATER_EDGE.springPlantCount, scatter.nextRandom, (plant) => {
        const cross = randomOffset(scatter.nextRandom, WATER_EDGE.springPlantCrossSpread / 2);
        const back = valueInRange(WATER_EDGE.springPlantBackRange, scatter.nextRandom());

        forceProp(
            plant,
            source.x + frame.acrossX * (reach * cross) - frame.alongX * (reach * back),
            source.z + frame.acrossZ * (reach * cross) - frame.alongZ * (reach * back),
            valueInRange(WATER_EDGE.plantScaleRange, scatter.nextRandom()),
            0,
            scatter
        );
    });
}

function decorateOutflow(
    course: IWaterCourse,
    speciesByLayer: ISpeciesByLayer,
    scatter: IPropScatterContext
): void {
    const boulders = speciesByLayer.rock;
    if (boulders.length === 0) return;

    const points = course.points;
    const mouth = points[points.length - 1];
    const frame = courseFrameAt(course, points.length - 1);
    const offset = mouth.halfWidth + WATER_EDGE.outflowStoneOffset;

    for (const side of [-1, 1]) {
        const boulder = pickRandomOrNull(boulders, scatter.nextRandom);
        if (!boulder) continue;

        forceProp(
            boulder,
            mouth.x + frame.acrossX * offset * side,
            mouth.z + frame.acrossZ * offset * side,
            valueInRange(WATER_EDGE.outflowStoneScaleRange, scatter.nextRandom()),
            WATER_EDGE.stoneSink,
            scatter
        );
    }
}

function decorateMudhole(
    course: IWaterCourse,
    speciesByLayer: ISpeciesByLayer,
    scatter: IPropScatterContext
): void {
    const points = course.points;
    const centre = points[Math.floor(points.length / 2)];
    const poolRadius = centre.halfWidth;
    const boulders = speciesByLayer.rock;
    const foliage = riverbankFoliage(speciesByLayer);

    scatterSpecies(boulders, WATER_EDGE.mudholeStoneCount, scatter.nextRandom, (boulder, index) => {
        const angle =
            (index / WATER_EDGE.mudholeStoneCount) * FULL_TURN +
            randomOffset(scatter.nextRandom, WATER_EDGE.mudholeStoneAngleJitter / 2);
        const distance =
            poolRadius + valueInRange(WATER_EDGE.mudholeStoneOffsetRange, scatter.nextRandom());

        forceProp(
            boulder,
            ...pointAtAngle(centre.x, centre.z, angle, distance),
            valueInRange(WATER_EDGE.mudholeStoneScaleRange, scatter.nextRandom()),
            WATER_EDGE.mudholeStoneSink,
            scatter
        );
    });

    scatterSpecies(foliage, WATER_EDGE.mudholePlantCount, scatter.nextRandom, (plant) => {
        const angle = scatter.nextRandom() * FULL_TURN;
        const distance =
            poolRadius + valueInRange(WATER_EDGE.mudholePlantOffsetRange, scatter.nextRandom());

        forceProp(
            plant,
            ...pointAtAngle(centre.x, centre.z, angle, distance),
            valueInRange(WATER_EDGE.plantScaleRange, scatter.nextRandom()),
            0,
            scatter
        );
    });

    if (poolRadius < WATER_EDGE.mudholeTreePoolRadius) return;

    const tree = pickRandomOrNull(speciesByLayer.canopy, scatter.nextRandom);
    if (!tree) return;

    const angle = scatter.nextRandom() * FULL_TURN;
    const distance =
        poolRadius + valueInRange(WATER_EDGE.mudholeTreeOffsetRange, scatter.nextRandom());

    forceProp(
        tree,
        ...pointAtAngle(centre.x, centre.z, angle, distance),
        valueInRange(WATER_EDGE.mudholeTreeScaleRange, scatter.nextRandom()),
        0,
        scatter
    );
}

const isFlowering = (prop: IThemeProp): boolean => /flower/i.test(prop.modelPath);

const riverbankFoliage = (speciesByLayer: ISpeciesByLayer): IThemeProp[] => [
    ...speciesByLayer.groundcover.filter((prop) => !isFlowering(prop)),
    ...speciesByLayer.understory.filter((prop) => !isFlowering(prop)),
];

function courseFrameAt(course: IWaterCourse, pointIndex: number): ISegmentFrame {
    const points = course.points;
    const isSource = pointIndex === 0;
    const spanEnd = isSource
        ? Math.min(pointIndex + WATER_EDGE.frameSpan, points.length - 1)
        : pointIndex;
    const spanStart = isSource ? pointIndex : Math.max(pointIndex - WATER_EDGE.frameSpan, 0);

    const fromPoint = points[spanStart];
    const toPoint = points[spanEnd];
    return segmentFrame(fromPoint.x, fromPoint.z, toPoint.x, toPoint.z);
}
