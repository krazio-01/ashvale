import type { ChapterTheme } from "@/types/realm";

export enum PropRole {
    Landmark = "landmark",
    Structure = "structure",
    Scatter = "scatter",
}

export interface IThemeProp {
    modelPath: string;
    role: PropRole;
    footprintRadius: number;
    scaleRange: [number, number];
    hasCollider: boolean;
}

export interface IThemeManifest {
    theme: ChapterTheme;
    props: IThemeProp[];
    scatterPropsPerFile: number;
    floorColor: string;
}

export interface IPropPlacement {
    position: [number, number, number];
    rotationY: number;
    scale: number;
}

export interface IPropGroup {
    modelPath: string;
    role: PropRole;
    hasCollider: boolean;
    footprintRadius: number;
    placements: IPropPlacement[];
}
