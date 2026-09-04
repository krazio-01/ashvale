import { PROP_TRANSFORM_STRIDE, type IPropGroup, type IThemeProp } from "@/types/theme";
import { TERRAIN } from "@/constants/world";

const BUCKET_KEY_OFFSET = 1 << 20;

export class PropCollector {
    private readonly buildersByBucket = new Map<number, Map<string, IGroupBuilder>>();

    add(
        prop: IThemeProp,
        hasCollider: boolean,
        worldX: number,
        worldY: number,
        worldZ: number,
        rotationY: number,
        scale: number
    ): void {
        const builder = this.builderFor(prop, hasCollider, worldX, worldZ);
        builder.transformValues.push(worldX, worldY, worldZ, rotationY, scale);
    }

    toBuckets(): IPropGroup[][] {
        const buckets: IPropGroup[][] = [];

        for (const buildersByModelPath of this.buildersByBucket.values()) {
            const groups: IPropGroup[] = [];

            for (const builder of buildersByModelPath.values())
                groups.push({
                    modelPath: builder.prop.modelPath,
                    layer: builder.prop.layer,
                    hasCollider: builder.hasCollider,
                    footprintRadius: builder.prop.footprintRadius,
                    instanceCount: builder.transformValues.length / PROP_TRANSFORM_STRIDE,
                    transforms: new Float32Array(builder.transformValues),
                });

            if (groups.length > 0) buckets.push(groups);
        }

        return buckets;
    }

    private builderFor(
        prop: IThemeProp,
        hasCollider: boolean,
        worldX: number,
        worldZ: number
    ): IGroupBuilder {
        const bucketKey = bucketKeyFor(worldX, worldZ);

        let buildersByModelPath = this.buildersByBucket.get(bucketKey);
        if (!buildersByModelPath) {
            buildersByModelPath = new Map<string, IGroupBuilder>();
            this.buildersByBucket.set(bucketKey, buildersByModelPath);
        }

        const existing = buildersByModelPath.get(prop.modelPath);
        if (existing) return existing;

        const builder: IGroupBuilder = { prop, hasCollider, transformValues: [] };
        buildersByModelPath.set(prop.modelPath, builder);

        return builder;
    }
}

function bucketKeyFor(worldX: number, worldZ: number): number {
    const bucketX = Math.floor(worldX / TERRAIN.bucketSize) + BUCKET_KEY_OFFSET;
    const bucketZ = Math.floor(worldZ / TERRAIN.bucketSize) + BUCKET_KEY_OFFSET;

    return bucketX * (BUCKET_KEY_OFFSET * 2) + bucketZ;
}

interface IGroupBuilder {
    prop: IThemeProp;
    hasCollider: boolean;
    transformValues: number[];
}
