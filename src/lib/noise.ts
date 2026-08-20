import { createSeededRandom, lerp } from "@/lib/helpers";

export class FractalNoise {
    private readonly permutation: number[];

    constructor(seed: number) {
        const nextRandom = createSeededRandom(seed);
        this.permutation = [];

        for (let index = 0; index < 256; index += 1)
            this.permutation.push(Math.floor(nextRandom() * 256));
    }

    sample(x: number, z: number, octaves: number, gain: number): number {
        let amplitude = 1;
        let frequency = 1;
        let total = 0;
        let range = 0;

        for (let octave = 0; octave < octaves; octave += 1) {
            total += this.sampleSingle(x * frequency, z * frequency) * amplitude;
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

    private sampleSingle(x: number, z: number): number {
        const cellX = Math.floor(x);
        const cellZ = Math.floor(z);
        const fractionX = x - cellX;
        const fractionZ = z - cellZ;

        const smoothX = fractionX * fractionX * (3 - 2 * fractionX);
        const smoothZ = fractionZ * fractionZ * (3 - 2 * fractionZ);

        const corner00 = this.cornerValue(cellX, cellZ);
        const corner10 = this.cornerValue(cellX + 1, cellZ);
        const corner01 = this.cornerValue(cellX, cellZ + 1);
        const corner11 = this.cornerValue(cellX + 1, cellZ + 1);

        return lerp(lerp(corner00, corner10, smoothX), lerp(corner01, corner11, smoothX), smoothZ);
    }

    private cornerValue(cellX: number, cellZ: number): number {
        const hashX = this.permutation[((cellX % 256) + 256) % 256] ?? 0;
        const hash = this.permutation[(hashX + (((cellZ % 256) + 256) % 256)) % 256] ?? 0;

        return hash / 255;
    }
}
