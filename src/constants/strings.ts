export const STORAGE_KEYS = {
    gameSettings: "ashvale_game_settings_v1",
};

export const APP_TEXT = {
    title: "Ashvale",
    description:
        "Explore any GitHub repository as a procedurally generated realm — its structure becomes terrain, its history becomes enemies.",
};

export const LANDING_TEXT = {
    tagline: "any public repository, rendered as a realm to explore",
    repoPrefix: "realm/",
    repoPlaceholder: "owner/repo",
    repoInputLabel: "GitHub repository",
    invalidRepo: "Enter a GitHub URL or owner/repo, like facebook/react",
    orbitHint: "drag or scroll to orbit",
    settingsTitle: "Settings",
    closeSettings: "Close",
};

export const LOADING_TEXT = {
    openingRealm: "Opening the realm",
    warmingShaders: "Warming the shaders",
    generatingRealm: "Generating your realm",
    unknownError: "Unknown error",
    stages: {
        inhabitants: "Waking the inhabitants",
        terrain: "Sculpting the terrain",
        soil: "Weathering the soil",
        ground: "Laying the ground",
        river: "Letting the river in",
        grasslands: "Sowing the grasslands",
        wildflowers: "Scattering wildflowers",
        woodland: "Planting the woodland",
    },
};

export const PAUSE_TEXT = {
    title: "Paused",
    resume: "Resume",
    resumeKey: "Esc",
    menuKey: "Tab",
    menuHint: "menu",
    settingsLabel: "Game settings",
    unsavedChanges: "Unsaved changes",
    discardChanges: "Discard unsaved changes?",
    presetSetAutomatically: "Set automatically when options don't match a preset",
};

export const OPTION_TEXT = {
    on: "On",
    off: "Off",
    low: "Low",
    medium: "Medium",
    high: "High",
    ultra: "Ultra",
    custom: "Custom",
    shown: "Shown",
    hidden: "Hidden",
    inverted: "Inverted",
    normal: "Normal",
    smaa: "SMAA",
};

export const SETTINGS_TEXT = {
    frameRateLimit: {
        label: "Frame rate limit",
        description: "Caps how many frames are drawn each second",
    },
    showFps: {
        label: "Frame rate counter",
        description: "Shows the current frame rate on screen",
    },
    resolutionScale: {
        label: "Resolution scale",
        description: "Renders above or below your display resolution, then scales to fit",
    },
    qualityPreset: {
        label: "Quality preset",
        description: "Sets every graphics option below at once",
    },
    shadows: {
        label: "Shadows",
        description: "Resolution of shadows cast by the sun",
    },
    bloom: {
        label: "Bloom",
        description: "Spreads a soft glow from the brightest parts of the scene",
    },
    antiAliasing: {
        label: "Anti-aliasing",
        description: "Smooths jagged edges along geometry",
    },
    outlines: {
        label: "Outlines",
        description: "Draws ink lines around objects and foliage",
    },
    atmosphere: {
        label: "Atmosphere",
        description: "Adds distance haze and horizon glow",
    },
    mouseSensitivity: {
        label: "Look sensitivity",
        description: "How far the camera turns for a given mouse movement",
    },
    invertY: {
        label: "Invert vertical look",
        description: "Moving the mouse up looks down instead",
    },
    fov: {
        label: "Field of view",
        description: "Widens or narrows the camera's view angle",
    },
};

export const CONTROL_TEXT = {
    groups: {
        movement: "Movement",
        combat: "Combat",
        camera: "Camera & Targeting",
    },
    keyLabels: { ShiftLeft: "Shift" } as Record<string, string>,
    mouseButtons: ["LMB", "MMB", "RMB"],
    mouse: "Mouse",
    scroll: "Scroll",
    move: { action: "Move", description: "Walk in any direction" },
    jump: { action: "Jump", description: "Leap over obstacles" },
    sprint: { action: "Sprint", description: "Hold to sprint" },
    dodge: {
        action: "Dodge",
        description: "Sidestep when moving left or right, otherwise step back",
    },
    crouch: { action: "Crouch", description: "Crouch and move quietly" },
    slide: { action: "Slide", description: "Press while sprinting to slide forward" },
    lightAttack: { action: "Light attack", description: "Fast strike, chains into a combo" },
    heavyAttack: { action: "Heavy attack", description: "Slow, powerful strike" },
    parry: {
        action: "Parry",
        description: "Deflect an incoming attack and open it up for a counter-kill",
    },
    draw: {
        action: "Draw / sheathe",
        description: "Draw or put away the sword; attacking draws it first",
    },
    finisher: {
        action: "Finisher",
        description: "Execute, backstab or counter-kill a vulnerable enemy",
    },
    look: { action: "Look", description: "Aim the camera" },
    lockOn: { action: "Lock-on", description: "Lock the camera onto the nearest enemy" },
    cycleTarget: {
        action: "Cycle target",
        description: "Switch between nearby enemies while locked on",
    },
};

export const HUD_TEXT = {
    vitality: "Vitality",
    stamina: "Stamina",
    finisherPrompts: {
        backstab: "Assassinate",
        execution: "Execute",
        counter: "Counter",
    },
};

export const ENEMY_NAMES = {
    sentinel: "Sentinel",
    golem: "Golem",
    gremlin: "Gremlin",
    wraith: "Wraith",
    boss: "Boss",
};

export const CHAPTER_TEXT = {
    arc: [
        { title: "The Founding", artifactName: "Ember of Origin" },
        { title: "The First Expansion", artifactName: "Shard of Ascent" },
        { title: "The Long Climb", artifactName: "Sigil of Endurance" },
        { title: "The Reckoning", artifactName: "Crown of Reckoning" },
        { title: "The Great Refactor", artifactName: "Kernel of Renewal" },
        { title: "The Widening", artifactName: "Lens of Expanse" },
        { title: "The Present Day", artifactName: "Heart of the Living Repo" },
    ],
    fallback: {
        title: "The Untold Era",
        artifactName: "Fragment of the Deep Log",
    },
};

export const PHYSICS_TUNER_TEXT = {
    title: "Cloth physics",
    sliders: {
        "cloth.damping": "Damping /s",
        "cloth.bendSoftness": "Bend softness",
        "cloth.stretchSoftness": "Stretch softness",
        "cloth.gravityScale": "Gravity",
        "cloth.windExposure": "Wind exposure",
        "cloth.pinSlack": "Pin slack",
        "cloth.maxDriftAtHem": "Drift at hem",
        "cloth.driftCurve": "Drift curve",
        "cloth.bodyGuardRadius": "Body guard radius",
        "cloth.bodyGuardDepth": "Body guard depth",
        "cloth.collisionThickness": "Collision thickness",
        "cloth.targetClearance": "Target clearance",
        "cloth.targetClearanceBlend": "Target clearance blend",
        "cloth.friction": "Friction /s",
        "reference.moveLag": "Move lag",
        "reference.turnLag": "Turn lag",
        "reference.turnFlingScale": "Turn fling",
        "reference.maxLagMoveSpeed": "Speed cap",
        "reference.maxLagTurnSpeed": "Turn cap",
        "restart.dampingSeconds": "Restart damping s",
        "restart.dampingScale": "Restart damping x",
        "environment.wind.base": "Wind",
        "environment.wind.gustAmplitude": "Wind gusts",
        "step.substepsPerFrame": "Substeps / 60 Hz frame",
    } as Record<string, string>,
};

export const API_MESSAGES = {
    success: "Success",
    realmForged: "Realm forged",
    featuredRealmsListed: "Featured realms listed",
    somethingWentWrong: "Something went wrong",
    unexpectedError: "An unexpected error occurred",
};

export const ERRORS = {
    missingEnvironmentVariable: (key: string) => `Missing required environment variable: ${key}`,
    animationFrameOutsideLoop: "useAnimationFrame must be used inside AnimationFrameLoop",
    modelNotLoaded: (kind: string, path: string) => `${kind} model not loaded: ${path}`,
    missingBone: (bone: string, owner: string) => `no ${bone} bone on ${owner}`,
    emptyBladeSpan: "no vertices inside the blade span, cannot measure thickness",
    missingWeaponMount: (weapon: string, mount: string) => `${weapon} has no ${mount} mount`,
    noDirectoriesWithFiles: "tree produced no directories containing files",
    pickFromEmptyList: "pickRandom called with an empty list",
    missingClipMarks: (clip: string) => `no clip marks for "${clip}" in CLIP_MARKS`,
    missingClipMark: (clip: string, mark: string) => `clip "${clip}" has no mark "${mark}"`,
    missingGripWindow: (clip: string) => `clip "${clip}" has no baked grip window`,
    unknownMove: (id: string) => `unknown move id "${id}"`,
    physicsDataVersion: (found: number, expected: number) =>
        `physics data version ${found} is not ${expected}: re-import and cook the model`,
    sheetTooSmall: (body: string) =>
        `physics body ${body}: a sheet needs at least 2 columns and 2 rows`,
    sheetNodeMismatch: (body: string, columns: number, rows: number) =>
        `physics body ${body}: node data does not match ${columns}x${rows}`,
    sheetNodeUnpinned: (body: string, node: number) =>
        `physics body ${body}: node ${node} has no pinned anchor`,
    unknownPhysicsBodyKind: (body: string, kind: string) =>
        `physics body ${body}: unknown kind ${kind}`,
    physicsBoneMissing: (bone: string) => `physics data names bone ${bone} but the model has none`,
    latticeBoneMissing: (bone: string) =>
        `physics lattice bone ${bone} is not in the model skeleton`,
    skinBoneMissing: (bone: string) => `physics skin bone ${bone} is not in the model skeleton`,
    latticeWithoutSkin: "physics lattice bones belong to no skinned mesh",
    tooManyColliders: (supported: number, requested: number) =>
        `solver supports ${supported} colliders, asked for ${requested}`,
};

export const LOG_MESSAGES = {
    missingAnimationClip: (clip: string) => `no animation clip named "${clip}"`,
    contributorsUnavailable: (sha: string) => `contributors unavailable for chapter ending ${sha}:`,
    subtreeUnavailable: (path: string) => `subtree unavailable for ${path}:`,
    settlementDidNotFit: (centerX: string, centerZ: string, halfWidth: string, halfDepth: string) =>
        `[settlement] no buildings fit region at (${centerX}, ${centerZ}) - half extents ${halfWidth} x ${halfDepth}`,
    propModelsFailed: (paths: string[]) =>
        `[AssetLibrary] ${paths.length} prop model(s) failed to load and will not render:\n  ${paths.join("\n  ")}`,
};

export enum HttpStatus {
    OK = 200,
    BAD_REQUEST = 400,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    CONFLICT = 409,
    UNPROCESSABLE_ENTITY = 422,
    TOO_MANY_REQUESTS = 429,
    INTERNAL_ERROR = 500,
    BAD_GATEWAY = 502,
}
