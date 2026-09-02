import { CanvasTexture, Color, LinearFilter, RepeatWrapping, Vector2, Vector4 } from "three";
import { GROUND_MATERIAL, SOIL_RAMP, TRAIL } from "@/constants/world";
import { clamp, shiftColorHsl, smoothstep } from "@/lib/helpers";
import { FractalNoise } from "@/lib/noise";
import type { ITerrainProfile } from "@/types/theme";

const TRAIL_WEAR_BAND: [number, number] = [
    TRAIL.halfWidth,
    TRAIL.halfWidth + TRAIL.wearFalloffWidth,
];

export const GROUND_MATERIAL_GLSL = /* glsl */ `
    uniform sampler2D groundSplat;
    uniform sampler2D groundDetail;
    uniform vec2 groundSplatScales;
    uniform vec2 groundFineMaskOffset;
    uniform float groundBroadMaskWeight;
    uniform float groundDetailScale;
    uniform vec4 groundDetailStrengths;
    uniform vec2 trailWearBand;
    uniform float trailWearFalloff;

    uniform vec3 loamColor;
    uniform vec3 driedEarthColor;
    uniform vec3 dustColor;
    uniform vec3 mudColor;
    uniform vec3 gritColor;

    uniform float loamBaseWeight;
    uniform float materialSharpness;
    uniform vec2 trailWearGains;

    float trailWearAt(float trailDistance) {
        return pow(
            1.0 - smoothstep(trailWearBand.x, trailWearBand.y, trailDistance),
            trailWearFalloff
        );
    }

    vec4 groundMaterialShareAt(vec2 groundPosition, float trailWear) {
        vec4 broad = texture2D(groundSplat, groundPosition * groundSplatScales.x);
        vec4 fine = texture2D(
            groundSplat,
            groundPosition * groundSplatScales.y + groundFineMaskOffset
        );
        vec4 masks = mix(fine, broad, groundBroadMaskWeight);

        vec4 weights = vec4(
            masks.r,
            masks.g + trailWear * trailWearGains.x,
            masks.b + trailWear * trailWearGains.y,
            masks.a
        );

        return exp((weights - loamBaseWeight) * materialSharpness);
    }

    vec2 groundGrowthOf(vec4 share) {
        float total = 1.0 + share.x + share.y + share.z + share.w;

        return vec2((1.0 + share.x) / total, 1.0 / (1.0 + share.x));
    }

    vec3 groundColorOf(vec4 share, vec2 groundPosition) {
        vec4 detail = texture2D(groundDetail, groundPosition * groundDetailScale);
        vec4 character = mix(1.0 - groundDetailStrengths, 1.0 + groundDetailStrengths, detail);
        float total = 1.0 + share.x + share.y + share.z + share.w;

        return (
            (loamColor + driedEarthColor * share.x) * character.r
            + dustColor * character.g * share.y
            + mudColor * character.b * share.z
            + gritColor * character.a * share.w
        ) / total;
    }
`;

export function groundMaterialUniforms(
    splatTexture: CanvasTexture,
    detailTexture: CanvasTexture,
    materials: IGroundMaterials
) {
    return {
        groundSplat: { value: splatTexture },
        groundDetail: { value: detailTexture },
        groundSplatScales: {
            value: new Vector2(1 / GROUND_MATERIAL.broadTileSpan, 1 / GROUND_MATERIAL.fineTileSpan),
        },
        groundFineMaskOffset: { value: new Vector2(...GROUND_MATERIAL.fineMaskOffset) },
        groundBroadMaskWeight: { value: GROUND_MATERIAL.broadMaskWeight },
        groundDetailScale: { value: 1 / GROUND_MATERIAL.detailTileSpan },
        groundDetailStrengths: { value: new Vector4(...GROUND_MATERIAL.detailStrengths) },
        trailWearBand: { value: new Vector2(...TRAIL_WEAR_BAND) },
        trailWearFalloff: { value: TRAIL.wearFalloffExponent },
        loamColor: { value: materials.loam },
        driedEarthColor: { value: materials.driedEarth },
        dustColor: { value: materials.dust },
        mudColor: { value: materials.mud },
        gritColor: { value: materials.grit },
        loamBaseWeight: { value: GROUND_MATERIAL.loamBaseWeight },
        materialSharpness: { value: GROUND_MATERIAL.sharpness },
        trailWearGains: {
            value: new Vector2(GROUND_MATERIAL.trailDustGain, GROUND_MATERIAL.trailMudGain),
        },
    };
}

export function trailWearAt(trailDistance: number): number {
    return Math.pow(
        1 - smoothstep(TRAIL_WEAR_BAND[0], TRAIL_WEAR_BAND[1], trailDistance),
        TRAIL.wearFalloffExponent
    );
}

export function deriveGroundMaterials(profile: ITerrainProfile): IGroundMaterials {
    const fromSoil = (step: ISoilRampStep): Color =>
        new Color(
            shiftColorHsl(
                profile.soilColor,
                step.hueShift,
                step.saturationScale,
                step.lightnessShift
            )
        );

    return {
        loam: fromSoil(SOIL_RAMP.loam),
        driedEarth: fromSoil(SOIL_RAMP.driedEarth),
        dust: fromSoil(SOIL_RAMP.dust),
        mud: fromSoil(SOIL_RAMP.mud),
        grit: new Color(
            shiftColorHsl(
                profile.rockColor,
                SOIL_RAMP.gritFromRock.hueShift,
                SOIL_RAMP.gritFromRock.saturationScale,
                SOIL_RAMP.gritFromRock.lightnessShift
            )
        ),
    };
}

export function buildGroundSplatTexture(seed: number): CanvasTexture {
    return buildMaskTexture(GROUND_MATERIAL.maskTileCounts, seed);
}

export function buildGroundDetailTexture(seed: number): CanvasTexture {
    return buildMaskTexture(
        GROUND_MATERIAL.detailTileCounts,
        seed + GROUND_MATERIAL.maskTileCounts.length
    );
}

function buildMaskTexture(tileCounts: number[], seed: number): CanvasTexture {
    const size = GROUND_MATERIAL.maskTextureSize;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const drawing = canvas.getContext("2d");
    if (!drawing) return new CanvasTexture(canvas);

    const pixels = drawing.createImageData(size, size);
    const channel = new Float32Array(size * size);

    tileCounts.forEach((tileCount, channelIndex) => {
        const noise = new FractalNoise(seed + channelIndex);
        let smallest = Infinity;
        let largest = -Infinity;

        for (let texel = 0; texel < channel.length; texel += 1) {
            const value = noise.sampleTileable(
                (texel % size) / size,
                Math.floor(texel / size) / size,
                tileCount,
                3,
                0.55
            );

            channel[texel] = value;

            if (value < smallest) smallest = value;
            if (value > largest) largest = value;
        }

        const span = largest - smallest;

        for (let texel = 0; texel < channel.length; texel += 1) {
            const stretched = span > 1e-6 ? ((channel[texel] ?? 0) - smallest) / span : 0.5;

            pixels.data[texel * 4 + channelIndex] = Math.round(255 * clamp(stretched, 0, 1));
        }
    });

    drawing.putImageData(pixels, 0, 0);

    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;

    return texture;
}

interface ISoilRampStep {
    hueShift: number;
    saturationScale: number;
    lightnessShift: number;
}

export interface IGroundMaterials {
    loam: Color;
    driedEarth: Color;
    dust: Color;
    mud: Color;
    grit: Color;
}
