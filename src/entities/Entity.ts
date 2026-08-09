export abstract class Entity {
    readonly id: string;
    position: [number, number, number];

    constructor(id: string, position: [number, number, number] = [0, 0, 0]) {
        this.id = id;
        this.position = position;
    }
}
