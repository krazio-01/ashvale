import {
    CanvasTexture,
    LinearFilter,
    LinearMipmapLinearFilter,
    MathUtils,
    RepeatWrapping,
} from "three";
import { clamp, createSeededRandom, lerp } from "@/lib/helpers";

const RANDOM_TABLE_SIZE = 256;

interface ITileableNoise {
    size: number;
    tileCounts: readonly number[];
    octaves: number;
    gain: number;
    mipmapped: boolean;
}

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

    sampleSigned(x: number, z: number, octaves: number, gain: number): number {
        return (this.sample(x, z, octaves, gain) - 0.5) * 2;
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

export function buildTileableNoiseTexture(
    { size, tileCounts, octaves, gain, mipmapped }: ITileableNoise,
    seed: number
): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const drawing = canvas.getContext("2d");
    if (!drawing) return new CanvasTexture(canvas);

    const pixels = drawing.createImageData(size, size);
    const channel = new Float32Array(size * size);
    pixels.data.fill(255);

    tileCounts.forEach((tileCount, channelIndex) => {
        const noise = new FractalNoise(seed + channelIndex);
        let smallest = Infinity;
        let largest = -Infinity;

        for (let texel = 0; texel < channel.length; texel += 1) {
            const value = noise.sampleTileable(
                (texel % size) / size,
                Math.floor(texel / size) / size,
                tileCount,
                octaves,
                gain
            );

            channel[texel] = value;

            if (value < smallest) smallest = value;
            if (value > largest) largest = value;
        }

        const span = largest - smallest;

        for (let texel = 0; texel < channel.length; texel += 1) {
            const stretched = span > 1e-6 ? (channel[texel] - smallest) / span : 0.5;

            pixels.data[texel * 4 + channelIndex] = Math.round(255 * clamp(stretched, 0, 1));
        }
    });

    drawing.putImageData(pixels, 0, 0);

    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter;
    texture.minFilter = mipmapped ? LinearMipmapLinearFilter : LinearFilter;
    texture.generateMipmaps = mipmapped;

    return texture;
}
