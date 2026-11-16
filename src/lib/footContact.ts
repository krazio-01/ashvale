import { PROCEDURAL_ANIMATION } from "@/constants/characters";

export class FootContact {
    lowestHeight: number;

    constructor(restHeight: number) {
        this.lowestHeight = restHeight;
    }

    reset(restHeight: number): void {
        this.lowestHeight = restHeight;
    }

    track(height: number, deltaSeconds: number): boolean {
        const { floorRise, liftHeight } = PROCEDURAL_ANIMATION.feet;
        this.lowestHeight = Math.min(this.lowestHeight + floorRise * deltaSeconds, height);
        return height - this.lowestHeight < liftHeight;
    }
}
