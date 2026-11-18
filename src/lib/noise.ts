import {
    CanvasTexture,
    LinearFilter,
    LinearMipmapLinearFilter,
    MathUtils,
    RepeatWrapping,
} from "three";
import { clamp, createSeededRandom, lerp } from "@/lib/helpers";

const RANDOM_TABLE_SIZE = 256;

const RANDOM_TABLE_MASK = RANDOM_TABLE_SIZE - 1;

interface ITileableNoise {
    size: number;
    tileCounts: readonly number[];
    octaves: number;
    gain: number;
    mipmapped: boolean;
}

export class FractalNoise {
    private readonly randomTable: Uint8Array;

    constructor(seed: number) {
        const nextRandom = createSeededRandom(seed);
        this.randomTable = new Uint8Array(RANDOM_TABLE_SIZE);

        for (let index = 0; index < RANDOM_TABLE_SIZE; index += 1)
            this.randomTable[index] = Math.floor(nextRandom() * RANDOM_TABLE_SIZE);
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

        const nearX = MathUtils.euclideanModulo(cellX, period);
        const nearZ = MathUtils.euclideanModulo(cellZ, period);
        const farX = nearX + 1 === period ? 0 : nearX + 1;
        const farZ = nearZ + 1 === period ? 0 : nearZ + 1;
        const table = this.randomTable;
        const nearHash = table[nearX & RANDOM_TABLE_MASK];
        const farHash = table[farX & RANDOM_TABLE_MASK];

        return lerp(
            lerp(
                table[(nearHash + nearZ) & RANDOM_TABLE_MASK] / 255,
                table[(farHash + nearZ) & RANDOM_TABLE_MASK] / 255,
                smoothX
            ),
            lerp(
                table[(nearHash + farZ) & RANDOM_TABLE_MASK] / 255,
                table[(farHash + farZ) & RANDOM_TABLE_MASK] / 255,
                smoothX
            ),
            smoothZ
        );
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
