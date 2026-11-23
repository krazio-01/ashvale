import {
    DataTexture,
    LinearFilter,
    LinearMipmapLinearFilter,
    RGBAFormat,
    SRGBColorSpace,
} from "three";

const LEAF_SHAPE = {
    halfWidth: 0.42,
    taper: 0.75,
    midribWidth: 0.025,
    midribShade: 0.75,
    edgeShade: 0.85,
};

interface IShapeTexel {
    shade: number;
    alpha: number;
}

type ShapeTexel = (across: number, along: number, texel: IShapeTexel) => void;

export function createShapeTexture(size: number, texelAt: ShapeTexel): DataTexture {
    const pixels = new Uint8Array(size * size * 4);
    const texel: IShapeTexel = { shade: 0, alpha: 0 };
    for (let y = 0; y < size; y += 1)
        for (let x = 0; x < size; x += 1) {
            texelAt(Math.abs((x + 0.5) / size - 0.5), (y + 0.5) / size, texel);
            const offset = (y * size + x) * 4;
            pixels.fill(Math.round(texel.shade * 255), offset, offset + 3);
            pixels[offset + 3] = Math.round(texel.alpha * 255);
        }
    const texture = new DataTexture(pixels, size, size, RGBAFormat);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
}

export const SHAPE_TEXELS = {
    glow: (across, along, texel) => {
        texel.shade = 1;
        texel.alpha = (1 - Math.min(1, Math.hypot(across, along - 0.5) * 2)) ** 2;
    },
    leaf: (across, along, texel) => {
        const { halfWidth, taper, midribWidth, midribShade, edgeShade } = LEAF_SHAPE;
        texel.shade =
            across < midribWidth ? midribShade : 1 - (1 - edgeShade) * (across / halfWidth);
        texel.alpha = across < halfWidth * Math.sin(Math.PI * along) ** taper ? 1 : 0;
    },
} satisfies Record<string, ShapeTexel>;
