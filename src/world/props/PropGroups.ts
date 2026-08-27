import type { IPropGroup, IPropPlacement, IThemeProp } from "@/types/theme";

export class PropGroupCollector {
    private readonly groupsByModelPath = new Map<string, IPropGroup>();
    private readonly collidersEnabled: boolean;

    constructor(collidersEnabled: boolean) {
        this.collidersEnabled = collidersEnabled;
    }

    add(prop: IThemeProp, placement: IPropPlacement): void {
        const existingGroup = this.groupsByModelPath.get(prop.modelPath);

        if (existingGroup) {
            existingGroup.placements.push(placement);
            return;
        }

        this.groupsByModelPath.set(prop.modelPath, {
            modelPath: prop.modelPath,
            role: prop.role,
            hasCollider: this.collidersEnabled && prop.hasCollider,
            footprintRadius: prop.footprintRadius,
            placements: [placement],
        });
    }

    toGroups(): IPropGroup[] {
        return [...this.groupsByModelPath.values()];
    }
}
