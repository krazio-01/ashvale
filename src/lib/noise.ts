import { createSeededRandom, lerp } from "@/lib/helpers";

const PERMUTATION_SIZE = 256;

export class FractalNoise {
    private readonly permutation: number[];

    constructor(seed: number) {
        const nextRandom = createSeededRandom(seed);
        this.permutation = [];

        for (let index = 0; index < PERMUTATION_SIZE; index += 1)
            this.permutation.push(Math.floor(nextRandom() * PERMUTATION_SIZE));
    }

    sample(x: number, z: number, octaves: number, gain: number): number {
        let amplitude = 1;
        let frequency = 1;
        let total = 0;
        let range = 0;

        for (let octave = 0; octave < octaves; octave += 1) {
            total += this.sampleSingle(x * frequency, z * frequency, PERMUTATION_SIZE) * amplitude;
            range += amplitude;
            amplitude *= gain;
            frequency *= 2;
        }

        return total / range;
    }

    sampleRidged(x: number, z: number, octaves: number, gain: number): number {
        const value = this.sample(x, z, octaves, gain);
        return 1 - Math.abs(2 * value - 1);
    }

    sampleTileable(
        unitX: number,
        unitZ: number,
        tileCount: number,
        octaves: number,
        gain: number
    ): number {
        let amplitude = 1;
        let frequency = 1;
        let total = 0;
        let range = 0;

        for (let octave = 0; octave < octaves; octave += 1) {
            const period = tileCount * frequency;

            total += this.sampleSingle(unitX * period, unitZ * period, period) * amplitude;
            range += amplitude;
            amplitude *= gain;
            frequency *= 2;
        }

        return total / range;
    }

    private sampleSingle(x: number, z: number, period: number): number {
        const cellX = Math.floor(x);
        const cellZ = Math.floor(z);
        const fractionX = x - cellX;
        const fractionZ = z - cellZ;

        const smoothX = fractionX * fractionX * (3 - 2 * fractionX);
        const smoothZ = fractionZ * fractionZ * (3 - 2 * fractionZ);

        const corner00 = this.cornerValue(cellX, cellZ, period);
        const corner10 = this.cornerValue(cellX + 1, cellZ, period);
        const corner01 = this.cornerValue(cellX, cellZ + 1, period);
        const corner11 = this.cornerValue(cellX + 1, cellZ + 1, period);

        return lerp(lerp(corner00, corner10, smoothX), lerp(corner01, corner11, smoothX), smoothZ);
    }

    private cornerValue(cellX: number, cellZ: number, period: number): number {
        const wrappedX = ((cellX % period) + period) % period;
        const wrappedZ = ((cellZ % period) + period) % period;

        const hashX = this.permutation[wrappedX % PERMUTATION_SIZE] ?? 0;
        const hash = this.permutation[(hashX + wrappedZ) % PERMUTATION_SIZE] ?? 0;

        return hash / 255;
    }
}
