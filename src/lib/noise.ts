import { MathUtils } from "three";
import { createSeededRandom, lerp } from "@/lib/helpers";

const RANDOM_TABLE_SIZE = 256;

export class FractalNoise {
    private readonly randomTable: number[];

    constructor(seed: number) {
        const nextRandom = createSeededRandom(seed);
        this.randomTable = [];

        for (let index = 0; index < RANDOM_TABLE_SIZE; index += 1)
            this.randomTable.push(Math.floor(nextRandom() * RANDOM_TABLE_SIZE));
    }

    sample(x: number, z: number, octaves: number, gain: number): number {
        return this.sumOctaves(x, z, octaves, gain, null);
    }

    sampleTileable(
        unitX: number,
        unitZ: number,
        tileCount: number,
        octaves: number,
        gain: number
    ): number {
        return this.sumOctaves(unitX, unitZ, octaves, gain, tileCount);
    }

    private sumOctaves(
        x: number,
        z: number,
        octaves: number,
        gain: number,
        tileCount: number | null
    ): number {
        let amplitude = 1;
        let frequency = 1;
        let total = 0;
        let range = 0;

        for (let octave = 0; octave < octaves; octave += 1) {
            const period = tileCount === null ? RANDOM_TABLE_SIZE : tileCount * frequency;
            const scale = tileCount === null ? frequency : period;

            total += this.sampleOneOctave(x * scale, z * scale, period) * amplitude;
            range += amplitude;
            amplitude *= gain;
            frequency *= 2;
        }

        return total / range;
    }

    private sampleOneOctave(x: number, z: number, period: number): number {
        const cellX = Math.floor(x);
        const cellZ = Math.floor(z);
        const fractionX = x - cellX;
        const fractionZ = z - cellZ;

        const smoothX = fractionX * fractionX * (3 - 2 * fractionX);
        const smoothZ = fractionZ * fractionZ * (3 - 2 * fractionZ);

        const corner00 = this.randomValueAtCorner(cellX, cellZ, period);
        const corner10 = this.randomValueAtCorner(cellX + 1, cellZ, period);
        const corner01 = this.randomValueAtCorner(cellX, cellZ + 1, period);
        const corner11 = this.randomValueAtCorner(cellX + 1, cellZ + 1, period);

        return lerp(lerp(corner00, corner10, smoothX), lerp(corner01, corner11, smoothX), smoothZ);
    }

    private randomValueAtCorner(cellX: number, cellZ: number, period: number): number {
        const wrappedX = MathUtils.euclideanModulo(cellX, period);
        const wrappedZ = MathUtils.euclideanModulo(cellZ, period);

        const hashX = this.randomTable[wrappedX % RANDOM_TABLE_SIZE];
        const hash = this.randomTable[(hashX + wrappedZ) % RANDOM_TABLE_SIZE];

        return hash / 255;
    }
}
