import { COVER_CHANNELS_GLSL, GROUND_MATERIAL_GLSL, MEADOW_GLSL } from "@/shaders/terrain";
import { SHARED_GLSL, glslFloat } from "@/shaders/sharedGlsl";
import { GROUND_COVER } from "@/constants/placement";

const SALTS = GROUND_COVER.hashSalts;

const TRAIL = GROUND_COVER.trail;

const GRASS_TRAIL_CURVE_GLSL = `
    float trailCurveAt(float age, float strength) {
        age = min(age / mix(${glslFloat(TRAIL.lightLifeShare)}, 1.0, strength), 1.0);
        float held = max(age - ${glslFloat(TRAIL.holdShare)}, 0.0) / ${glslFloat(1 - TRAIL.holdShare)};
        float spring = exp(-${glslFloat(TRAIL.naturalFrequency)} * held) * (1.0 + ${glslFloat(TRAIL.naturalFrequency)} * held);
        return spring * (1.0 - smoothstep(0.9, 1.0, age));
    }
`;

export const COVER_VERTEX_GLSL = `
    uniform sampler2D terrainField;
    uniform vec2 fieldOrigin;
    uniform float fieldCellSize;
    uniform float fieldPointsPerSide;
    uniform sampler2D coverMap;
    uniform vec2 coverMapOrigin;
    uniform float coverMapSpan;
    uniform vec2 coverSeed;
    uniform vec2 cameraGround;
    uniform float cellSpacing;
    uniform float coverReach;
    uniform float coverFullReach;
    uniform float coverFalloff;
    uniform float coverFloorShare;
    uniform float coverFadeStart;
    uniform float coverRankFadeWidth;
    uniform float windSway;
    uniform float windFlutter;
    uniform float windStrength;
    uniform sampler2D grassTrail;
    uniform vec3 grassTrailWindow;
    uniform float grassTrailAgeShare;

    attribute vec2 cellOffset;
    attribute vec2 bandRange;

    ${COVER_CHANNELS_GLSL}

    vec2 coverCellAt() {
        return floor(cameraGround / cellSpacing) + cellOffset;
    }

    vec3 coverRandom(vec2 cell, float salt) {
        return hashTriple(vec3(cell + coverSeed, salt));
    }

    float groundHeightAt(vec2 ground) {
        return sampleFieldPoint(terrainField, vec4(fieldOrigin, fieldCellSize, fieldPointsPerSide), ground).r;
    }

    vec4 coverMapAt(vec2 ground) {
        return texture2D(coverMap, (ground - coverMapOrigin) / coverMapSpan);
    }

    vec2 worldGroundOf(vec2 ground) {
        return ground + modelMatrix[3].xz;
    }

    ${GRASS_TRAIL_CURVE_GLSL}

    vec2 trailBendAt(vec2 ground) {
        vec2 trailUv = (worldGroundOf(ground) - grassTrailWindow.xy) / grassTrailWindow.z;
        vec2 trailEdge = min(trailUv, 1.0 - trailUv);
        float trailInside = smoothstep(0.0, ${glslFloat(TRAIL.edgeFadeShare)}, min(trailEdge.x, trailEdge.y));
        if (trailInside <= 0.0) return vec2(0.0);
        vec4 trail = texture2D(grassTrail, trailUv);
        float age = min(trail.a + grassTrailAgeShare, 1.0);
        return (trail.rg * 2.0 - 1.0) * trail.b * trailCurveAt(age, trail.b) * ${glslFloat(TRAIL.pressBend)} * trailInside;
    }

    float inBandAt(float distance) {
        return step(bandRange.x, distance) * (1.0 - step(bandRange.y, distance));
    }

    float reachFadeAt(float distance) {
        return 1.0 - smoothstep(coverFadeStart, coverReach, distance);
    }

    float coverShareAt(float distance) {
        return clamp(pow(coverFullReach / max(distance, coverFullReach), coverFalloff), coverFloorShare, 1.0);
    }

    float coverKeepAt(float distance, float share, float rank) {
        return inBandAt(distance) * reachFadeAt(distance)
            * clamp((share * (1.0 + coverRankFadeWidth) - rank) / max(coverRankFadeWidth * rank, 0.0001), 0.0, 1.0);
    }
`;

export const COVER_BAKE_GLSL = `
    uniform sampler2D terrainField;
    uniform sampler2D coverField;
    uniform vec2 fieldOrigin;
    uniform float fieldCellSize;
    uniform float fieldPointsPerSide;
    uniform float coverPointsPerSide;
    uniform float coverSubdivisions;
    uniform vec2 coverMapOrigin;
    uniform float coverMapSpan;
    uniform vec2 steepGroundBand;
    uniform vec2 growthStopBand;
    uniform vec2 coverTrailBand;
    uniform vec2 fullCoverBand;
    uniform vec2 coverSeed;
    uniform vec3 forestBand;
    uniform vec3 clearingBand;
    uniform vec3 wetnessBand;
    uniform vec2 coverWarpWavelengths;
    uniform float coverWarpReach;
    uniform float trailEdgeJitter;
    uniform float footprintJitter;

    varying vec2 vMapUv;

    ${GROUND_MATERIAL_GLSL}
    ${COVER_CHANNELS_GLSL}
    ${SHARED_GLSL.maths}

    vec2 fieldPointCoordAt(vec2 ground) {
        return (ground - fieldOrigin) / fieldCellSize;
    }

    vec4 sampleTerrainField(vec2 pointCoord) {
        return texture2D(terrainField, (pointCoord + 0.5) / fieldPointsPerSide);
    }

    float insideTerrainField(vec2 pointCoord) {
        float lastPoint = fieldPointsPerSide - 1.0;

        return step(0.0, pointCoord.x) * step(pointCoord.x, lastPoint)
            * step(0.0, pointCoord.y) * step(pointCoord.y, lastPoint);
    }

    float withinGrowableGround(float steepness, float growthStopDistance) {
        float offSteepGround = 1.0 - smoothstep(steepGroundBand.x, steepGroundBand.y, steepness);
        float shortOfStop = 1.0 - smoothstep(growthStopBand.x, growthStopBand.y, growthStopDistance);

        return offSteepGround * shortOfStop;
    }

    float coverRamp(vec3 band, float value) {
        float ratio = clamp((value - band.x) / (band.y - band.x), 0.0, 1.0);

        return mix(band.z, 1.0, ratio * ratio * (3.0 - 2.0 * ratio));
    }

    vec4 coverCuesAt(vec2 pointCoord) {
        return texture2D(coverField, (pointCoord * coverSubdivisions + 0.5) / coverPointsPerSide);
    }

    float coverAffinityAt(vec4 cues) {
        return coverRamp(forestBand, cues.r)
            * coverRamp(clearingBand, cues.g)
            * coverRamp(wetnessBand, cues.b);
    }

    vec3 groundCoverAt(vec2 ground, vec2 mapGround, vec4 field, vec4 groundCues) {
        vec2 growth = groundGrowthOf(groundMaterialShareAt(mapGround, 0.0));
        float trailEdge = field.g
            + (layeredNoise(mapGround, coverWarpWavelengths, coverSeed + ${glslFloat(SALTS.trailNoise)}) - 0.5) * trailEdgeJitter;
        float offTrail = smoothstep(coverTrailBand.x, coverTrailBand.y, trailEdge);
        float unblocked = 1.0 - coverCuesAt(fieldPointCoordAt(mapGround)).a;
        float footprintEdge = field.a
            + (layeredNoise(mapGround, coverWarpWavelengths, coverSeed + ${glslFloat(SALTS.footprintNoise)}) - 0.5) * footprintJitter;

        return vec3(
            growth.x * offTrail * unblocked * coverAffinityAt(groundCues),
            growth.y * offTrail,
            withinGrowableGround(field.b, footprintEdge)
        );
    }

    float smoothNoise(vec2 point) {
        return valueNoise(point + coverSeed);
    }

    uniform float patchSpacing;
    uniform vec2 patchRadiusRange;
    uniform float patchChance;
    uniform float patchCoreRatio;
    uniform float patchEdgeWavelength;
    uniform float patchEdgeStrength;

    vec2 patchDensityAt(vec2 ground) {
        vec2 baseCell = floor(ground / patchSpacing);
        float rimScale = mix(
            1.0 - patchEdgeStrength,
            1.0 + patchEdgeStrength,
            smoothNoise(ground / patchEdgeWavelength)
        );
        float strongest = 0.0;
        float speciesPick = 0.0;

        for (int offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
            for (int offsetX = -1; offsetX <= 1; offsetX += 1) {
                vec2 cell = baseCell + vec2(float(offsetX), float(offsetZ));
                float occupancy = hashScalar(cell + coverSeed + vec2(${glslFloat(SALTS.patchOccupancy)}));
                if (occupancy > patchChance) continue;

                vec3 candidate = jitteredCellAt(cell, patchSpacing, coverSeed);
                vec2 centre = candidate.xy;
                float radius = max(
                    mix(patchRadiusRange.x, patchRadiusRange.y, candidate.z) * rimScale,
                    0.001
                );
                float density = 1.0 - smoothstep(patchCoreRatio, 1.0, length(ground - centre) / radius);
                if (density <= strongest) continue;

                strongest = density;
                speciesPick = occupancy / patchChance;
            }
        }

        return vec2(strongest, speciesPick);
    }
`;

export const COVER_BAKE_VERTEX_SHADER = `
    varying vec2 vMapUv;

    void main() {
        vMapUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

export const COVER_BAKE_MAIN = `
    void main() {
        vec2 mapGround = coverMapOrigin + vMapUv * coverMapSpan;
        vec2 ground = mapGround + coverWarpReach * (vec2(
            layeredNoise(mapGround, coverWarpWavelengths, coverSeed),
            layeredNoise(mapGround, coverWarpWavelengths, coverSeed.yx + 0.5)
        ) - 0.5);
        vec2 mapPointCoord = fieldPointCoordAt(mapGround);

        gl_FragColor = bakeCoverAt(ground, mapGround, sampleTerrainField(mapPointCoord))
            * insideTerrainField(mapPointCoord);
    }
`;

export const GRASS_SHADERS: ICoverShaderSet = {
    bake: `
    uniform float clumpWavelength;
    uniform float dryPatchWavelength;
    uniform vec2 dryPatchBand;
    uniform float patchContrast;
    uniform float bedThinning;
    uniform vec2 patchFullBand;

    vec4 bakeCoverAt(vec2 ground, vec2 mapGround, vec4 field) {
        vec4 groundCues = coverCuesAt(fieldPointCoordAt(ground));
        vec3 cover = groundCoverAt(ground, mapGround, field, groundCues);
        float flowerBedThinning = 1.0 - bedThinning * patchDensityAt(ground).x;
        float patchiness = (layeredNoise(ground, coverWarpWavelengths, coverSeed.yx) - 0.5)
            * 2.0
            * patchContrast
            * (1.0 - smoothstep(patchFullBand.x, patchFullBand.y, cover.x));
        float meadow = smoothstep(fullCoverBand.x, fullCoverBand.y, cover.x * (1.0 + patchiness));
        float dryPatch = smoothstep(
            dryPatchBand.x,
            dryPatchBand.y,
            smoothNoise(ground / dryPatchWavelength)
        );

        float dryness = clamp(1.0 - cover.y + dryPatch, 0.0, 1.0);

        return vec4(
            meadow * cover.z * flowerBedThinning,
            packCoverMoisture(dryness, groundCues.b),
            smoothNoise(ground / clumpWavelength),
            meadow
        );
    }
`,
    vertex: {
        declarations: `
        uniform vec2 bladeHeightRange;
        uniform float bladeWidth;
        uniform float bladeSink;
        uniform float bladeTaper;
        uniform vec2 widthJitter;
        uniform float bladeLean;
        uniform float bladeLeanBase;
        uniform float bendRiseLoss;
        uniform float tallBoost;
        uniform float viewFacing;
        uniform vec2 coverageHeight;
        uniform vec2 clumpKeep;
        uniform vec2 clumpHeight;
        uniform float windSwayGain;
        uniform float windRestShare;
        uniform vec2 gustBand;
        uniform float maxWidthGain;
        uniform float tuftCellSize;
        uniform float tuftReach;
        uniform vec2 tuftHeight;
        uniform float tuftLean;
        uniform float tuftToneShift;
        uniform float stalkShare;
        uniform float stalkStretch;
        uniform float dryAmount;
        uniform float dryPatchGain;
        uniform vec2 tipJitter;
        uniform float gustBright;
        uniform float normalUpBlend;
        uniform float sideTilt;
        uniform float heightSkew;
        uniform float tallShare;
        uniform float tallStretch;
        uniform float bladeRoundness;

        attribute vec4 bladeData;
        attribute vec4 bladeTraits;
        attribute float bladeRank;

        varying vec4 vBladeTone;
        varying float vBladeClump;
        varying float vBladeHeight;
    `,
        body: `
        vec2 coverCell = coverCellAt();
        vec3 cellShift = coverRandom(coverCell, ${glslFloat(SALTS.bladeCell)});
        vec4 blade = fract(bladeData + vec4(cellShift, cellShift.x + cellShift.y));

        vec2 bladeGround = (coverCell + blade.xy) * cellSpacing;
        vec4 grassCover = coverMapAt(bladeGround);
        float bladeDistance = distance(bladeGround, cameraGround);
        float bladeShare = coverShareAt(bladeDistance);
        float bladeKeep = step(blade.z, grassCover.r * mix(clumpKeep.x, clumpKeep.y, grassCover.b))
            * coverKeepAt(bladeDistance, bladeShare, bladeRank);

        vec3 transformed = vec3(0.0);
        vec3 objectNormal = vec3(0.0, 1.0, 0.0);
        vBladeTone = vec4(0.0);
        vBladeClump = 0.0;
        vBladeHeight = 0.0;

        if (bladeKeep > 0.0) {
            vec4 traits = fract(bladeTraits + cellShift.zxyz);
            vec2 bladeMoisture = coverMoistureOf(grassCover);
            vec4 tuft = nearestCellAt(bladeGround, tuftCellSize, coverSeed);
            float tuftCloseness = 1.0 - smoothstep(0.0, tuftReach * tuftCellSize, tuft.z);
            vec2 towardTuft = normalize(tuft.xy - bladeGround + vec2(0.0001));
            float tallBlade = step(traits.x, tallShare);
            float stalk = step(1.0 - stalkShare, traits.x);
            float bladeHeight = mix(bladeHeightRange.x, bladeHeightRange.y, pow(blade.w, heightSkew))
                * mix(1.0, tallStretch, tallBlade)
                * mix(1.0, stalkStretch, stalk)
                * mix(tuftHeight.x, tuftHeight.y, tuftCloseness * tuft.w)
                * mix(coverageHeight.x, coverageHeight.y, grassCover.r)
                * mix(1.0, tallBoost, bladeMoisture.y)
                * mix(clumpHeight.x, clumpHeight.y, grassCover.b)
                * bladeKeep;

            float bladeYaw = traits.y * PI2;
            vec2 bladeFacing = vec2(cos(bladeYaw), sin(bladeYaw));
            vec2 bladeAcross = vec2(-bladeFacing.y, bladeFacing.x);
            vec2 towardCamera = normalize(cameraGround - bladeGround + vec2(0.0001));
            vec2 viewSide = vec2(-towardCamera.y, towardCamera.x);
            float edgeOn = 1.0 - abs(dot(bladeFacing, towardCamera));
            bladeAcross = normalize(mix(
                bladeAcross,
                viewSide * sign(dot(bladeAcross, viewSide) + 0.0001),
                edgeOn * viewFacing * (1.0 - bladeShare)
            ));
            bladeFacing = vec2(bladeAcross.y, -bladeAcross.x);

            float windWave = windGustAt(worldGroundOf(bladeGround));
            float bladeSway = (windWave - windRestShare) * windSway * windSwayGain
                + sin(windFlutterPhase + blade.w * PI2) * windFlutter * windWave;

            float bladeRatio = position.y;
            vec2 bladeBend = (bladeFacing * bladeLean * (bladeLeanBase + blade.w) + windDirection * bladeSway + towardTuft * tuftLean * tuftCloseness + trailBendAt(bladeGround))
                * bladeRatio * bladeRatio * bladeHeight;
            float bladeRise = bladeRatio * bladeHeight * (1.0 - bendRiseLoss * clamp(
                dot(bladeBend, bladeBend) / max(bladeHeight * bladeHeight, 0.0001),
                0.0,
                1.0
            ));
            float bladeWidthHere = bladeWidth
                * (1.0 - bladeRatio * bladeTaper)
                * mix(widthJitter.x, widthJitter.y, blade.z)
                * min(maxWidthGain, 1.0 / bladeShare)
                * mix(1.0, 1.0 / tallStretch, tallBlade)
                * mix(1.0, 1.0 / stalkStretch, stalk);

            transformed = vec3(
                bladeGround.x + bladeAcross.x * position.x * bladeWidthHere + bladeBend.x,
                groundHeightAt(bladeGround) - bladeSink + bladeRise,
                bladeGround.y + bladeAcross.y * position.x * bladeWidthHere + bladeBend.y
            );
            vec3 terrainNormal = groundNormalAt(terrainField, vec4(fieldOrigin, fieldCellSize, fieldPointsPerSide), bladeGround);
            objectNormal = normalize(mix(
                vec3(bladeFacing.x, sideTilt, bladeFacing.y)
                    + vec3(bladeAcross.x, 0.0, bladeAcross.y) * sign(position.x) * bladeRoundness,
                terrainNormal,
                mix(normalUpBlend, 1.0, 1.0 - bladeShare)
            ));

            vBladeTone = vec4(
                clamp(bladeMoisture.x * dryAmount * dryPatchGain + (blade.w - 0.5) * dryAmount, 0.0, 1.0),
                traits.z,
                mix(tipJitter.x, tipJitter.y, traits.w) * (1.0 + (tuft.w - 0.5) * tuftToneShift),
                1.0 + gustBright * smoothstep(gustBand.x, gustBand.y, windWave)
            );
            vBladeClump = grassCover.b;
            vBladeHeight = bladeRatio;
        }
    `,
    },
    fragment: {
        declarations: `
        ${MEADOW_GLSL}

        varying vec4 vBladeTone;
        varying float vBladeClump;
        varying float vBladeHeight;
    `,
        body: `
        diffuseColor.rgb = meadowColorAt(
            mix(meadowFloorHeight, 1.0, vBladeHeight),
            vBladeTone.x,
            vBladeTone.y,
            vBladeTone.z,
            vBladeClump
        ) * vBladeTone.w;
    `,
    },
};

export const FLOWER_SHADERS: ICoverShaderSet = {
    bake: `
    uniform float coverage;
    uniform vec2 bloomCoverBand;

    vec4 bakeCoverAt(vec2 ground, vec2 mapGround, vec4 field) {
        vec2 bloomPatch = patchDensityAt(ground);
        vec3 cover = groundCoverAt(ground, mapGround, field, coverCuesAt(fieldPointCoordAt(ground)));

        return vec4(
            bloomPatch.x * coverage * smoothstep(bloomCoverBand.x, bloomCoverBand.y, cover.x) * cover.z,
            bloomPatch.y,
            0.0,
            0.0
        );
    }
`,
    vertex: {
        declarations: `
        uniform vec2 scaleRange;
        uniform float swayStrength;
        uniform vec3 speciesColors[3];

        attribute float partKind;
        attribute float swayWeight;

        varying float vBloomPart;
        varying float vPetalReach;
        varying vec3 vSpeciesColor;
    `,
        body: `
        vec2 coverCell = coverCellAt();
        vec3 cellRandom = coverRandom(coverCell, ${glslFloat(SALTS.bloomPlace)});
        vec3 shapeRandom = coverRandom(coverCell, ${glslFloat(SALTS.bloomShape)});

        vec2 bloomGround = (coverCell + cellRandom.xy) * cellSpacing;
        vec4 bloomCover = coverMapAt(bloomGround);
        float bloomDistance = distance(bloomGround, cameraGround);
        float bloomScale = mix(scaleRange.x, scaleRange.y, shapeRandom.x)
            * step(cellRandom.z, bloomCover.r)
            * coverKeepAt(bloomDistance, coverShareAt(bloomDistance), shapeRandom.z);

        vSpeciesColor = speciesColors[int(min(bloomCover.g * 3.0, 2.0))];

        float yaw = shapeRandom.y * PI2;
        float yawCos = cos(yaw);
        float yawSin = sin(yaw);
        vec3 turned = vec3(
            position.x * yawCos - position.z * yawSin,
            position.y,
            position.x * yawSin + position.z * yawCos
        );

        vec2 trailLean = trailBendAt(bloomGround);
        float trailLeanLength = length(trailLean);
        float leanAngle = min(trailLeanLength, 1.0) * ${glslFloat(TRAIL.flowerLeanRadians)};
        turned.xz += trailLean / max(trailLeanLength, 0.0001) * turned.y * sin(leanAngle);
        turned.y *= cos(leanAngle);

        float swayFactor = partKind > 0.5 ? 1.0 : swayWeight;
        vec2 sway = windDirection * (windGustAt(worldGroundOf(bloomGround)) * 2.0 - 1.0)
            * swayStrength * windStrength * swayFactor;

        vec3 transformed = vec3(bloomGround.x, groundHeightAt(bloomGround), bloomGround.y)
            + (turned + vec3(sway.x, 0.0, sway.y)) * bloomScale;
        vec3 objectNormal = normalize(vec3(
            normal.x * yawCos - normal.z * yawSin,
            normal.y,
            normal.x * yawSin + normal.z * yawCos
        ));

        vBloomPart = partKind;
        vPetalReach = swayWeight;
    `,
    },
    fragment: {
        declarations: `
        uniform vec3 stemColor;
        uniform float tipLightnessGain;
        uniform float throatDarken;

        varying float vBloomPart;
        varying float vPetalReach;
        varying vec3 vSpeciesColor;
    `,
        body: `
        vec3 petalColor = mix(
            vSpeciesColor * throatDarken,
            vSpeciesColor * (1.0 + tipLightnessGain),
            vPetalReach
        );
        diffuseColor.rgb = mix(stemColor, petalColor, vBloomPart);
    `,
    },
};

interface ICoverShader {
    declarations: string;
    body: string;
}

export interface ICoverShaderSet {
    bake: string;
    vertex: ICoverShader;
    fragment: ICoverShader;
}

export const GRASS_TRAIL_UPDATE_FRAGMENT = `
    uniform sampler2D previousTrail;
    uniform vec2 shiftTexels;
    uniform float trailSide;
    uniform vec4 presses[${TRAIL.maxStamped}];
    uniform vec4 pressMotions[${TRAIL.maxStamped}];
    uniform vec4 pressTails[${TRAIL.maxStamped}];
    uniform int pressCount;
    varying vec2 vMapUv;

    ${GRASS_TRAIL_CURVE_GLSL}

    void main() {
        vec2 from = vMapUv + shiftTexels / trailSide;
        bool inside = all(greaterThanEqual(from, vec2(0.0))) && all(lessThanEqual(from, vec2(1.0)));
        vec4 trail = inside ? texture2D(previousTrail, from) : vec4(${TRAIL.neutralTexel.map((channel) => glslFloat(channel / 255)).join(", ")});
        trail.a = min(trail.a + ${glslFloat(TRAIL.ageStepsPerTick / TRAIL.ageStepRange)}, 1.0);
        float live = trail.b * trailCurveAt(trail.a, trail.b);
        for (int index = 0; index < ${TRAIL.maxStamped}; index++) {
            if (index >= pressCount) break;
            vec4 press = presses[index];
            vec2 along = pressTails[index].xy - press.xy;
            vec2 fromHead = vMapUv - press.xy;
            float segment = clamp(dot(fromHead, along) / max(dot(along, along), 0.0000001), 0.0, 1.0);
            vec2 away = fromHead - along * segment;
            float reach = length(away);
            float strength = press.w * (1.0 - smoothstep(press.z * 0.5, press.z, reach));
            if (strength <= live) continue;
            vec4 motion = pressMotions[index];
            vec2 radial = away / max(reach, 0.00001);
            vec2 direction = normalize(mix(motion.xy, radial, motion.z * smoothstep(0.0, press.z, reach)) + vec2(0.00001));
            trail = vec4(direction * 0.5 + 0.5, strength, 0.0);
            live = strength;
        }
        gl_FragColor = trail;
    }
`;
