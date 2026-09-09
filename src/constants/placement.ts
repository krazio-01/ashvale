import { pair } from "@/lib/helpers";
import { CAMERA } from "./characters";
import { TRAIL, WORLD_EDGE } from "./world";

const PROP_VIEW_RATIO_OF_CAMERA_FAR = 0.5;

/* Shared by GRASS, GROUND_COVER and PROP_FIELD.softEdges, all three of which fade density as a
   point approaches the world-edge apron. They used to be three independently-tuned numbers -
   GRASS and GROUND_COVER already agreed by coincidence (14 each), but PROP_FIELD.softEdges'
   mesh-prop fade used 10, meaning bushes and rocks stayed at full density for 4m past where
   grass had already started thinning near the world's edge. Same defect as the trail-band one
   already fixed above (coverTrailBand), same fix: one constant, not three that can drift apart.
   Caught in review. */
const WORLD_EDGE_FADE_WIDTH = 14;

export const GRASS = {
    levelRadii: [15, 45, 150],
    tuftSpacing: 0.38,
    /* fraction of tuftSpacing, not tuftSpacing itself - the root's elevation is sampled once at
       tuftGround, so a blade root allowed to wander a full grid cell away (as this used to,
       before this was its own ratio) could end up displaced onto ground the sampled height
       doesn't describe, floating or clipping on a slope, and blades from neighbouring tufts
       could interleave enough to blur each clump's identity. Caught in review. */
    tuftSpreadRatio: 0.35,
    bladesPerTuft: 5,
    bladeHeightRange: pair(0.32, 0.62),
    bladeWidth: 0.1,
    bladeTaperExponent: 0.6,
    bladeCurvature: 0.6,
    leanRange: pair(0.35, 0.95),
    steepGroundBand: pair(0.58, 0.9),
    worldEdgeFadeWidth: WORLD_EDGE_FADE_WIDTH,
    growth: {
        crushedHeightRatio: 0.4,
        crushedExtraLean: 0.7,
    },
    wind: {
        heading: 0.95,
        bendSpread: 1.1,
        waveLength: 14,
        waveSpeed: 1.1,
        sway: 0.45,
        flutter: 0.15,
        flutterSpeed: 5.5,
    },
    tone: {
        tuftToneWeight: 0.45,
        tintRange: pair(0.82, 1.1),
        lushHueShift: 0.03,
        dryHueShift: -0.05,
        tipLightnessGain: 0.18,
        rootDarken: 0.45,
    },
    light: {
        sunWrap: 0.42,
        sunGain: 0.55,
        ambientGain: 0.85,
        baseOcclusion: 0.42,
        tipSheen: 0.06,
    },
};

export const LEDGE = {
    stepRiseOfJumpApex: 0.7,
    maxAlongCorridorRatio: 0.3,
    safeRiseOfJumpApex: 0.95,
    rocksPerStep: 3,
    rockWidthOfCorridorHalfWidth: 0.22,
    rockWidthJitter: 0.45,
    lateralSpreadOfCorridorHalfWidth: 0.75,
    alongSpreadOfRockWidth: 1.6,
    riseJitter: 0.18,
    buriedDepth: 1.5,
};

export const PROP_FIELD = {
    activationRadius: CAMERA.far * PROP_VIEW_RATIO_OF_CAMERA_FAR,
    /* every prop bucket is one visibility toggle covering a whole TERRAIN.bucketSize (220m)
       tile - without this, every bucket near the horizon switches on/off at the exact same
       350m radius, so a whole 220m slab of forest pops into existence at once as the player
       approaches. Each bucket gets its own activation radius instead, offset by a deterministic
       hash of its own position (same bucket always gets the same jitter, so nothing shifts
       between rebuilds) so nearby buckets pop in across a spread of distances rather than in
       one synchronised wall. This is a zero-cost fix - same batch count, same draw calls, only
       WHEN each one appears changes - deliberately not a true per-instance fade: this pipeline
       bakes every instance's absolute world position directly into its matrix with no
       per-bucket transform to scale around, so fading would mean rewriting every instance
       matrix in a transitioning bucket every frame, which is a materially bigger and riskier
       change than this problem currently justifies.

       Kept modest (+/-10%, not more) rather than a wider spread: the nearest jittered radius
       already sits inside where this theme's own fog starts mattering (around 44% transmittance
       at 350m for Woodland's fogDensity), and pushing the near edge much closer than that would
       trade a synchronised pop for a partially-visible one instead of a genuinely hidden one. */
    activationJitter: 0.1,
    /* a single activation radius means a player idling or slowly circling exactly at a bucket's
       boundary flips its visibility every frame the camera's position happens to cross it -
       toggling Object3D.visible itself is cheap, but a whole 220m slab of forest flickering
       in and out is a real, avoidable visual artifact. Deactivation requires moving this much
       further out than activation did, the standard hysteresis-band fix for a boundary a value
       can linger on. Caught in review. */
    deactivationMargin: 15,
    occupancyCellSize: 6,
    collidingPropBudget: 900,
    groundBite: 0.02,
    placementAttempts: 8,
    typicalFileCount: 20,
    richnessRange: pair(0.5, 2),

    /* the trail, slope and island-lip limits used to be hard rejects, which put a razor edge
       on every path and clearing. Each keeps its hard limit and now ramps ground-level foliage
       density to zero across a band on the safe side, so cover thins into the boundary instead
       of stopping at it. */
    softEdges: {
        /* trailClearance stays its own value rather than exactly TRAIL.halfWidth: mesh props
           (bushes, small plants) are physically larger than a GPU grass blade and need a small
           walkability buffer beyond the path's own edge before anything is allowed to grow, not
           just a cosmetic fade start. trailFadeWidth is derived so this band's OUTER edge still
           lands on the same distance every other trail-adjacent system reaches full growth at
           (TRAIL.halfWidth + TRAIL.wearFalloffWidth) - the one thing that has to line up across
           ground colour, GPU grass/blooms and mesh props, even though each can start its own
           fade from a different inner point. */
        trailClearance: 2.25,
        trailFadeWidth: TRAIL.halfWidth + TRAIL.wearFalloffWidth - 2.25,
        slopeFadeRatio: 0.7,
        /* was independently set to 10 - see WORLD_EDGE_FADE_WIDTH's own comment above for why
           that let mesh props stay at full density for 4m past where GPU grass had already
           started thinning near the world's edge. */
        apronFadeWidth: WORLD_EDGE_FADE_WIDTH,
    },

    keepOut: {
        combatArenaRatio: 0.35,
        enemySpawnClearance: 3,
        laneClearanceRatio: 1.05,
        chapterSpawnClearance: 7,
    },

    clump: {
        candidateSpacing: 46,
        maskWavelength: 110,
        maskOctaves: 3,
        maskGain: 0.5,
        forestThreshold: 0.46,
        outcropThreshold: 0.6,
        radiusRange: pair(12, 24),
        canopySpeciesPerClump: 2,
        understorySpeciesPerClump: 3,
        groundcoverSpeciesPerClump: 4,
    },

    /* Problem 5 from the placement brief: trees near the camera and trees at the horizon spawn
       at the same density, which reads as "the generator's render distance ended here" rather
       than "the forest continues".

       An earlier version of this tried to bias seedClumps' density by raw distance from the
       chapter centre. Caught in review, on two independent grounds: (1) distance-from-centre
       does not correlate with distance-from-player - a player standing in an outer region
       would have the boost apply to trees right around them and NOT to the trees across the
       map toward the centre, inverting the intended effect; (2) more fundamentally, EVERY prop
       of every layer is hard-rejected once footprintDistance exceeds WORLD_EDGE.groundApron
       (24m) from the nearest region or corridor, unconditionally - and clump.candidateSpacing
       (46m) is already wider than that entire reachable band, so tuning clump-level density or
       existence thresholds can only ever affect a granularity coarser than the band it would
       need to operate in. No amount of retuning those two numbers could have worked.

       distantTreeline replaces that with a separate pass operating at the right granularity -
       per instance, using the same footprintDistance sample the hard limit already reads -
       confined to a band just beyond where normal props stop rather than trying to reach the
       whole chapter radius. It only ever places canopy trees, and only past the boundary the
       player is already physically walled off from by TerrainEdgeBarrier's fence (roughly
       groundApron + lipWidth * barrierLipRatio =~ 30m), so it can afford to skip the occupancy
       grid and the collider budget entirely: nothing else is ever placed out there to collide
       with, and the player can never reach it to need a collider. */
    distantTreeline: {
        /* candidates on this grid land inside the eligible footprintDistance band about as
           often as PROP_FIELD.groundcoverPatch's grid does for its own mask - dense enough to
           read as a treeline, not so dense it costs more than the clump canopy pass already does */
        candidateSpacing: 14,
        maskWavelength: 70,
        /* Two corrections found in review, on top of the first (extraReach 40 -> lipWidth,
           already explained below and still true as far as it goes):

           1. innerReach used to start at groundApron (24m), the same place every other pass
              stops. But the player is not actually kept out of the ground past groundApron -
              TerrainEdgeBarrier's fence, the thing that ACTUALLY blocks them, sits further out
              at groundApron + lipWidth*barrierLipRatio (30m). Numerically tracing the edge-drop's
              own slope (not assuming it): with the old 0.7 slopeLimit, the only band gentle
              enough to pass at all was [24, ~29.4] - entirely BEFORE the fence, i.e. inside the
              area the player can walk to and through. Non-colliding "background" trees the
              player can actually reach and clip through is worse than the pop-in this whole
              problem exists to fix. innerReach now starts at the fence itself, never before it.

           2. slopeLimit raised from 0.7 (canopy's own normal tolerance) to 2.5. The edge-drop's
              slope is not gentle immediately past the fence and never was - it is already ~1.0
              AT the fence and rises past 2.0 within another 1.5m, with no flat stretch anywhere
              past groundApron until the sunken floor beyond WALKABLE_REACH (see extraReach's own
              note). 0.7 here would pass nothing at all past the fence. 2.5 was chosen by tracing
              the actual curve, not guessed: it keeps roughly a 2.5m-wide band immediately past
              the fence, before the slope climbs further, rather than either passing zero
              candidates or reaching deep enough into the climbing slope to look absurd. */
        innerReach: WORLD_EDGE.groundApron + WORLD_EDGE.lipWidth * WORLD_EDGE.barrierLipRatio,
        /* extraReach of 40 (reaching to groundApron+40=64m) was wrong, caught in review: the
           terrain's own edge-drop (TerrainGeneration's edgeDropAt) ramps from 0 to a full 70m
           fall between groundApron (24m) and WALKABLE_REACH (groundApron+lipWidth=44m), then
           goes CONSTANT and FLAT again beyond 44m, still 70m down. A slope check alone cannot
           reject that flat-but-sunken floor - it reads as level ground to the same steepness
           test that correctly rejects the actual cliff face in between. Trees placed anywhere
           past 44m would sit at the bottom of that drop, invisible or wrong from the player's
           vantage on the plateau above, not "background scenery". Now measured from innerReach
           (the fence) rather than groundApron, and kept small - the slopeLimit above is the
           real limiter here, this is just a hard backstop so a numerical edge case in the slope
           calculation can never reach anywhere near the sunken floor at WALKABLE_REACH. */
        extraReach: 8,
        innerDensity: 0.08,
        outerDensity: 0.4,
        slopeLimit: 2.5,
        scaleBoost: pair(1.1, 1.6),
    },

    /* One low-frequency noise field assigns a dominant canopy family to every point in the
       chapter, evenly dividing the field's range into one band per family present in the
       current theme (2-4 bands depending on the biome). At 200m wavelength a 350m-radius
       chapter shows roughly 3-4 dominant regions across it, matching "reference games keep
       one dominant tree species per region" rather than a single family end to end or
       constant flicker.

       Averaging multiple octaves of this noise compounds toward its mean, so equal-width bands
       cut from the raw value starve whichever family lands on an outer band - measured across
       many seeds, 2 octaves alone put ~84% of the chapter's area in the two middle bands
       against ~16% for the two outer ones. Dropping to 1 octave alone (an earlier version of
       this fix) only partly closed that (~15/38/32/15). What actually equalises it, checked
       numerically rather than assumed: keep 2 octaves for the richer, less circular noise
       character, and remap regionValue through smoothstep(0.1, 0.9, .) - an S-curve that
       stretches the noise's dense middle back out and compresses its sparse tails - BEFORE
       banding it. Verified this combination against three variants across 8 seeds: 1 octave
       alone (15/38/32/15), the remap alone on top of 1 octave (31/22/17/30 - it OVER-corrects
       and inverts which bands are starved), and 2 octaves plus the remap together (24/28/23/24
       - the most balanced of the three, and the one actually shipped here).

       transitionWidth is the fraction of a band, centred on its boundary, over which a
       clump's dominant and neighbouring family are both live candidates - within that band a
       clump's own random draw decides which of the two it gets, which is what makes the
       overlap read as mixed rather than as a hard cut. */
    biomeRegion: {
        wavelength: 200,
        octaves: 2,
        gain: 0.5,
        /* stretches the noise's dense middle and compresses its sparse tails before banding -
           see the equalisation numbers above. Not a generic constant to retune casually: 0.1/0.9
           was chosen because it's what measured out as balanced for THIS noise function's
           actual distribution, not a default S-curve shape. */
        equalizeBand: pair(0.1, 0.9),
        transitionWidth: 0.4,
    },

    canopy: {
        density: 0.0035,
        centreBias: 0.8,
        spacingGap: 1.4,
        slopeLimit: 0.7,
        scaleBoost: pair(1.1, 1.7),
    },

    rock: {
        density: 0.005,
        centreBias: 0.6,
        spacingGap: 0.7,
        slopeLimit: 1.1,
        scaleBoost: pair(0.9, 1.6),
    },

    understory: {
        density: 0.008,
        /* raised from 0.55, and the huddle is now centre-weighted rather than area-uniform:
           bushes gathering against a trunk is the read we want, and an even spread across the
           huddle disc left them ringing the tree at arm's length instead */
        huddleRatio: 0.7,
        huddleRadius: 2.6,
        huddleCentreBias: 1.4,
        centreBias: 0.6,
        spacingGap: 0.15,
        slopeLimit: 1.1,
        scaleBoost: pair(0.9, 1.25),
    },

    groundcover: {
        density: 0.01,
        centreBias: 0.5,
        spacingGap: 0.05,
        slopeLimit: 0.9,
        scaleBoost: pair(0.9, 1.2),
    },

    /* Open-ground groundcover was sampled uniformly across the whole field disc and then
       rejection-masked, which is uniform scatter with a soft mask and no clump structure at
       all - 888 plants over a 350m field, each one isolated, never touching another. These
       place clumps instead: a jittered grid of candidate sites, each filled with plants of a
       single species around a jittered centre whose reach is warped by noise.

       Measured against a 350m field: 102 patches averaging 3.0m radius and 21 plants, so
       0.75 plants per square metre inside a patch - dense enough to read as a stand - for
       2151 instances against the old 888. The 2.4x is spent on cluster legibility: 888
       plants spread over 102 patches would be 9 each, which does not read as a patch at all.
       Groundcover carries no colliders and batches by model path per 220m bucket, so the
       cost is instance data and triangles, not draw calls. countRange is the dial if the
       frame budget says otherwise. */
    groundcoverPatch: {
        spacing: 42,
        maskWavelength: 86,
        maskThreshold: 0.5,
        radiusRange: pair(2.4, 5.0),
        countRange: pair(16, 38),
        /* exponent on a uniform roll: 0.5 spreads plants evenly per unit area, above that
           weights the core, so a patch has a dense middle and a ragged edge */
        coreBias: 0.8,
        rimWavelength: 6,
        rimStrength: 0.5,
        speciesPerPatch: 1,
    },

    debris: {
        density: 0.0014,
        trailShoulderRatio: 0.45,
        shoulderOffsetRatio: pair(0.25, 0.7),
        centreBias: 0.5,
        spacingGap: 0,
        slopeLimit: 1.2,
        scaleBoost: pair(0.9, 1.15),
    },

    /* Every standing (colliding) prop - a canopy tree or a rock, this catalogue has no
       distinct ruin/structure meshes so those two layers are the whole vocabulary - gets a
       small guaranteed handful of groundcover clutter at its base, placed before the prop's
       own footprint is reserved so the clutter can start partway UNDER its visual edge rather
       than being kept out by the same exclusion disc every other prop respects. That is the
       fix for "props look placed, not embedded": today a boulder guarantees a bare ring at
       least footprintRadius + spacingGap wide, because nothing is allowed to reserve ground
       inside its own disc.

       This is deliberately NOT the same mechanism as PROP_FIELD.understory's clump-neighbour
       huddling: huddling clusters larger bushes near a few trees WITHIN a clump, at arm's
       length; this embeds small clutter at the base of literally every standing prop anywhere
       in the field - clump members, water-edge boulders, mudhole stones - because embedding is
       about how one prop meets the ground under it, not about clumping behaviour between props.

       Deliberately skips the soft trail/slope/apron density mask (edgeDensityAt): the brief
       calls for "guaranteed" density at a base, not a probabilistic one, so this reuses only
       the hard terrain limits (water, apron, slope, trail clearance) via passesHardLimits.

       Instance budget: bounded above by collidingPropBudget (900) * maximumCount (6) = 5400 in
       the extreme case, but that requires every standing prop in the field to both max out the
       collider budget AND have a footprint wide enough to hit maximumCount - a realistic
       chapter (roughly the ~800 standing props measured for problem 2's clustering pass, at an
       average 2-3 clutter items each given typical footprint radii of 1-1.5m) adds on the
       order of 2000-2500 instances, comparable to the 2151 groundcover-patch already accepted
       for problem 2. Groundcover carries no colliders and batches by model path, so this is
       instance data and triangles, not draw calls or physics. */
    embedding: {
        minimumCount: 2,
        maximumCount: 6,
        countPerFootprintMetre: 2.6,
        /* fractions of the HOST's own footprint radius, not the clutter's. This placement
           model is 2D footprint math throughout - there is no 3D surface sampling anywhere in
           this pipeline - so innerRadiusRatio is a deliberately conservative compromise: low
           enough that clutter reads as touching/slightly overlapping the host's edge, not so
           low that most of it lands core-first inside a boulder's solid footprint and is never
           seen. outerRadiusRatio reaches a little past where the host's own exclusion disc
           alone would have been the nearest anything else could get. */
        innerRadiusRatio: 0.65,
        outerRadiusRatio: 1.45,
        placementAttempts: 4,
        rules: {
            density: 0,
            slopeLimit: 1.1,
            scaleBoost: pair(0.7, 1.05),
            centreBias: 0.7,
            spacingGap: 0.02,
        },
    },
};

export const GROUND_COVER = {
    steepGroundBand: pair(0.58, 0.9),
    worldEdgeFadeWidth: WORLD_EDGE_FADE_WIDTH,
    /* Derived from TRAIL rather than a second hand-tuned pair: coverTrailBand and the ground
       COLOUR wear ramp (TRAIL.halfWidth/wearFalloffWidth, read by trailWearAt) used to be two
       independently-tuned bands that only approximately lined up - verified numerically in
       review to diverge by up to 7% residual ground-colour wear still showing under fully-grown
       grass at the vegetation band's own outer edge. Deriving one from the other makes that
       drift structurally impossible instead of something to re-verify by hand after every future
       TRAIL retune. */
    coverTrailBand: pair(TRAIL.halfWidth, TRAIL.halfWidth + TRAIL.wearFalloffWidth),
};

export const BLOOM = {
    levelRadii: [20, 52],
    cellSpacing: 1.15,
    petalsPerBloom: 5,
    stemHeightRange: pair(0.17, 0.29),
    petalLength: 0.11,
    petalWidth: 0.07,
    petalRise: 0.55,
    scaleRange: pair(0.75, 1.2),
    coverage: 0.9,
    swayStrength: 0.16,

    /* blooms used to be gated on 26m gradient noise, which spread a ~30% spawn chance evenly
       across the whole meadow - visually a haze of lone flowers. These describe discrete
       clumps instead: ~42% of 9m cells hold a patch of radius 2.4-5.2m, so a patch is a few
       dozen blooms of one species in an irregular blob, and the ground between patches is
       genuinely empty. Coverage is comparable overall (chance * mean patch area / cell area
       is about 0.24), so the instance count is redistributed rather than increased. */
    patch: {
        spacing: 9,
        radiusRange: pair(2.4, 5.2),
        chance: 0.42,
        coreRatio: 0.32,
        edgeWavelength: 4.5,
        edgeStrength: 0.45,
    },
    tone: {
        tipLightnessGain: 0.16,
        throatDarken: 0.62,
        stemHueShift: -0.02,
        stemLightnessShift: -0.06,
        speciesHueSpread: 0.27,
    },
    light: {
        sunWrap: 0.5,
        sunGain: 0.6,
        ambientGain: 0.9,
    },
};

export const WATER_EDGE = {
    /* a spring narrower than this still needs a basin wide enough to read as one */
    minimumSpringRadius: 4,
    /* points along a course sit about a metre apart, so a direction taken between neighbours
       is dominated by meander noise; a span of several points gives the real flow direction */
    frameSpan: 2,
    stoneSink: 0.3,
    stoneScaleJitter: 0.15,
    springPlantCount: 10,
    springPlantCrossSpread: 1.8,
    springPlantBackRange: pair(0.2, 1.1),
    plantScaleRange: pair(0.85, 1.3),
    outflowStoneOffset: 2,
    outflowStoneScaleRange: pair(1.3, 1.8),
    mudholeStoneCount: 6,
    mudholeStoneAngleJitter: 0.4,
    mudholeStoneOffsetRange: pair(0.3, 1.7),
    mudholeStoneScaleRange: pair(0.8, 1.3),
    mudholeStoneSink: 0.2,
    mudholePlantCount: 14,
    mudholePlantOffsetRange: pair(0.2, 2),
    mudholeTreePoolRadius: 4,
    mudholeTreeOffsetRange: pair(3, 5),
    mudholeTreeScaleRange: pair(0.9, 1.2),
};
