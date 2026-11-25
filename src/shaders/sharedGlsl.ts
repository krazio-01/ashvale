import { ATMOSPHERE, STYLE, WIND } from "@/constants/world";
import { CAMERA } from "@/constants/player";
import type { Matrix3 } from "three";
import { OKLAB_MATRICES } from "@/lib/helpers";

const SKY_GLSL = `
uniform vec3 skyZenithColor;
uniform vec3 skyMiddleColor;
uniform vec3 skyHorizonColor;

vec3 skyGradientAt(vec3 direction) {
    float altitude = max(direction.y, 0.0);
    return mix(
        mix(skyHorizonColor, skyMiddleColor, smoothstep(0.0, ${glslFloat(ATMOSPHERE.middleAltitude)}, altitude)),
        skyZenithColor,
        smoothstep(${glslFloat(ATMOSPHERE.middleAltitude)}, 1.0, altitude)
    );
}
`;

const SUN_DIRECTION_GLSL = "uniform vec3 styleSunDirection;";

const WIND_GLSL = `
uniform float windGustTravel;
uniform float windFlutterPhase;
uniform vec2 windDirection;

float windGustAt(vec2 ground) {
    return layeredNoise(ground - windDirection * windGustTravel, vec2(${glslFloat(WIND.gust.wavelengths[0])}, ${glslFloat(WIND.gust.wavelengths[1])}), vec2(${glslFloat(WIND.gust.seed)}));
}
`;

export const SHARED_GLSL = {
    worldVertexUniforms: `
uniform float time;
${WIND_GLSL}
${SUN_DIRECTION_GLSL}
`,
    wind: WIND_GLSL,
    maths: `
vec2 hashPair(vec2 point) {
    vec3 scattered = fract(vec3(point.xyx) * vec3(0.1031, 0.1030, 0.0973));
    scattered += dot(scattered, scattered.yzx + 33.33);
    return fract((scattered.xx + scattered.yz) * scattered.zy);
}

float hashScalar(vec2 point) {
    return hashPair(point).x;
}

vec3 hashTriple(vec3 point) {
    vec3 scattered = fract(point * vec3(0.1031, 0.1030, 0.0973));
    scattered += dot(scattered, scattered.yxz + 33.33);
    return fract((scattered.xxy + scattered.yxx) * scattered.zyx);
}

float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 within = fract(point);
    vec2 blend = within * within * (3.0 - 2.0 * within);
    return mix(
        mix(hashScalar(cell), hashScalar(cell + vec2(1.0, 0.0)), blend.x),
        mix(hashScalar(cell + vec2(0.0, 1.0)), hashScalar(cell + vec2(1.0, 1.0)), blend.x),
        blend.y
    );
}

float layeredNoise(vec2 point, vec2 wavelengths, vec2 seed) {
    return 0.6 * valueNoise(point / wavelengths.x + seed) + 0.4 * valueNoise(point / wavelengths.y + seed);
}

mat2 rotation2d(float angle) {
    float cosine = cos(angle);
    float sine = sin(angle);
    return mat2(cosine, sine, -sine, cosine);
}

mat3 turnOf(vec3 angles) {
    vec3 c = cos(angles);
    vec3 s = sin(angles);
    return mat3(c.y, 0.0, -s.y, 0.0, 1.0, 0.0, s.y, 0.0, c.y)
        * mat3(1.0, 0.0, 0.0, 0.0, c.x, s.x, 0.0, -s.x, c.x)
        * mat3(c.z, s.z, 0.0, -s.z, c.z, 0.0, 0.0, 0.0, 1.0);
}

vec4 sampleFieldPoint(sampler2D field, vec4 fieldFrame, vec2 ground) {
    return texture2D(field, ((ground - fieldFrame.xy) / fieldFrame.z + 0.5) / fieldFrame.w);
}

vec3 jitteredCellAt(vec2 cell, float cellSize, vec2 seed) {
    vec3 placement = hashTriple(vec3(cell + seed, 29.0));
    return vec3((cell + placement.xy) * cellSize, placement.z);
}

vec4 nearestCellAt(vec2 point, float cellSize, vec2 seed) {
    vec2 baseCell = floor(point / cellSize);
    vec4 nearest = vec4(0.0, 0.0, 1e9, 0.0);
    for (int offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
        for (int offsetX = -1; offsetX <= 1; offsetX += 1) {
            vec2 cell = baseCell + vec2(float(offsetX), float(offsetZ));
            vec3 candidate = jitteredCellAt(cell, cellSize, seed);
            float gap = length(point - candidate.xy);
            if (gap < nearest.z) nearest = vec4(candidate.xy, gap, candidate.z);
        }
    }
    return nearest;
}

vec3 groundNormalAt(sampler2D field, vec4 fieldFrame, vec2 ground) {
    float reach = fieldFrame.z;
    float left = sampleFieldPoint(field, fieldFrame, ground - vec2(reach, 0.0)).r;
    float right = sampleFieldPoint(field, fieldFrame, ground + vec2(reach, 0.0)).r;
    float near = sampleFieldPoint(field, fieldFrame, ground - vec2(0.0, reach)).r;
    float far = sampleFieldPoint(field, fieldFrame, ground + vec2(0.0, reach)).r;
    return normalize(vec3(left - right, 2.0 * reach, near - far));
}
`,
    rockSurface: `
uniform vec3 styleRockColor;
uniform sampler2D styleRockDetail;
uniform vec2 styleRockDetailScale;
uniform vec4 styleRockMoss;
uniform vec4 styleRockDust;
uniform vec4 styleRockSnow;
uniform sampler2D styleGroundField;
uniform vec4 styleGroundFieldFrame;
uniform float styleRockFootFade;

vec4 styleRockDetailAt(vec3 worldPosition, vec3 worldNormal) {
    vec3 facing = worldNormal * worldNormal;
    facing *= facing;
    facing /= facing.x + facing.y + facing.z;
    float scale = styleRockDetailScale.x;
    vec4 sampled = texture2D(styleRockDetail, worldPosition.zy * scale) * facing.x
        + texture2D(styleRockDetail, worldPosition.xz * scale) * facing.y
        + texture2D(styleRockDetail, worldPosition.xy * scale) * facing.z;
    return vec4(mix(vec3(1.0), sampled.rgb * 2.0, styleRockDetailScale.y), sampled.a);
}

vec3 styleRockWeather(vec3 color, vec3 worldNormal, vec2 worldGround, float snowShare) {
    float rockPatch = (valueNoise(worldGround / ${glslFloat(STYLE.rock.patchWavelength)}) - 0.5) * ${glslFloat(STYLE.rock.patchStrength)};
    float rockFacing = worldNormal.y + rockPatch;
    color = mix(color, styleRockDust.rgb, (1.0 - smoothstep(${glslFloat(STYLE.rock.dustFacing[0])}, ${glslFloat(STYLE.rock.dustFacing[1])}, rockFacing)) * styleRockDust.a);
    color = mix(color, styleRockMoss.rgb, smoothstep(${glslFloat(STYLE.rock.mossFacing[0])}, ${glslFloat(STYLE.rock.mossFacing[1])}, rockFacing) * styleRockMoss.a);
    return mix(color, styleRockSnow.rgb, smoothstep(${glslFloat(STYLE.rock.snowFacing[0])}, ${glslFloat(STYLE.rock.snowFacing[1])}, rockFacing) * styleRockSnow.a * snowShare);
}

float styleRockFootAt(vec3 worldPosition) {
    if (styleRockFootFade <= 0.0) return 0.0;
    float ground = sampleFieldPoint(styleGroundField, styleGroundFieldFrame, worldPosition.xz).r;
    return 1.0 - smoothstep(0.0, styleRockFootFade, worldPosition.y - ground);
}

vec3 styleGroundViewNormalAt(vec2 worldGround) {
    return normalize((viewMatrix * vec4(groundNormalAt(styleGroundField, styleGroundFieldFrame, worldGround), 0.0)).xyz);
}
`,
    light: `
uniform float styleStylize;
uniform float styleWrap;
uniform vec3 styleSunColor;
uniform vec3 styleSkyFill;
uniform float styleTranslucency;

float styleDiffuse(float rawNL) {
    float wrapped = clamp(mix(rawNL, (rawNL + styleWrap) / (1.0 + styleWrap), styleStylize), 0.0, 1.0);
    return mix(
        wrapped,
        smoothstep(0.0, ${glslFloat(STYLE.stylizeContrastEdge)}, wrapped),
        styleStylize * ${glslFloat(STYLE.stylizeContrastShare)}
    );
}

vec3 styleSkyLight(float towardSun) {
    return (styleSunColor * max(towardSun, 0.0) + styleSkyFill) * ${glslFloat(1 / Math.PI)};
}

float styleSpecularWeight(float rawNL) {
    return (1.0 - ${glslFloat(STYLE.specularStylizeDamping)} * styleStylize) * clamp(rawNL, 0.0, 1.0);
}
`,
    sky: SKY_GLSL,
    skyFog: `
${SKY_GLSL}
${SUN_DIRECTION_GLSL}
uniform float styleFogDensity;
uniform float styleFogFalloff;
uniform float styleFogBase;
uniform float styleFogCameraTerm;
uniform vec3 styleFogSunColor;
uniform float styleFogSunStrength;

vec4 styleFogAt(vec3 worldPosition) {
    vec3 ray = worldPosition - cameraPosition;
    float rayLength = length(ray);
    vec3 direction = ray / max(rayLength, 0.001);
    float rise = clamp(ray.y * styleFogFalloff, -${glslFloat(STYLE.fogRiseLimit)}, ${glslFloat(STYLE.fogRiseLimit)});
    float heightTerm = styleFogCameraTerm * (abs(rise) > 0.001 ? (1.0 - exp(-rise)) / rise : 1.0);
    float travelled = max(rayLength - ${glslFloat(CAMERA.targetFollowDistance)}, 0.0);
    float amount = max(
        1.0 - exp(-styleFogDensity * travelled * heightTerm),
        smoothstep(${glslFloat(CAMERA.far * STYLE.fogFarFadeShare)}, ${glslFloat(CAMERA.far)}, rayLength)
    );
    float towardSun = pow(max(dot(direction, styleSunDirection), 0.0), ${glslFloat(STYLE.fogSunFocus)});
    return vec4(mix(skyGradientAt(direction), styleFogSunColor, towardSun * styleFogSunStrength), amount);
}

vec3 styleFog(vec3 color, vec3 worldPosition) {
    vec4 fog = styleFogAt(worldPosition);
    return mix(color, fog.rgb, fog.a);
}
`,
    seasonTint: `
flat varying vec3 vStyleTreeTint;

vec3 styleTreeTintAt(vec2 treeOrigin, vec3 tint) {
    vec2 treeHash = hashPair(treeOrigin);
    float treeTurn = (treeHash.x - 0.5) * ${glslFloat(STYLE.canopyVariety.hueSpread)};
    float treeStrength = mix(
        ${glslFloat(STYLE.canopyVariety.strengthRange[0])},
        ${glslFloat(STYLE.canopyVariety.strengthRange[1])},
        treeHash.y
    );
    return vec3(rotation2d(treeTurn) * tint.xy, clamp(tint.z * treeStrength, 0.0, 1.0));
}
`,
    seasonShift: `
flat varying vec3 vStyleTreeTint;

vec3 styleSeasonShift(vec3 color) {
    vec3 lms = pow(max(${glslMat3(OKLAB_MATRICES.linearToCone)} * color, vec3(0.0)), vec3(1.0 / 3.0));
    vec3 lab = ${glslMat3(OKLAB_MATRICES.coneToLab)} * lms;
    lab.yz = mix(lab.yz, vStyleTreeTint.xy, vStyleTreeTint.z);
    vec3 shifted = ${glslMat3(OKLAB_MATRICES.labToCone)} * lab;
    return max(${glslMat3(OKLAB_MATRICES.coneToLinear)} * (shifted * shifted * shifted), vec3(0.0));
}
`,
};

export function glslFloat(value: number): string {
    return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

function glslMat3(matrix: Matrix3): string {
    return `mat3(${matrix.elements.map(glslFloat).join(", ")})`;
}
