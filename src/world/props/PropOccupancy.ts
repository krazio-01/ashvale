import { clamp } from "@/lib/helpers";

const EMPTY_CELL = -1;
const INITIAL_CAPACITY = 512;

export class PropOccupancy {
    private readonly cellSize: number;
    private readonly cellsPerSide: number;
    private readonly halfSpan: number;
    private readonly cellHead: Int32Array;

    private discCenterX: Float32Array = new Float32Array(INITIAL_CAPACITY);
    private discCenterZ: Float32Array = new Float32Array(INITIAL_CAPACITY);
    private discRadius: Float32Array = new Float32Array(INITIAL_CAPACITY);
    private discVisitedInQuery: Int32Array = new Int32Array(INITIAL_CAPACITY);
    private discCount = 0;

    private entryDisc: Int32Array = new Int32Array(INITIAL_CAPACITY);
    private entryNextInCell: Int32Array = new Int32Array(INITIAL_CAPACITY);
    private entryCount = 0;

    private queryStamp = 0;

    constructor(halfSpan: number, cellSize: number) {
        this.halfSpan = halfSpan;
        this.cellSize = cellSize;
        this.cellsPerSide = Math.max(1, Math.ceil((halfSpan * 2) / cellSize));
        this.cellHead = new Int32Array(this.cellsPerSide * this.cellsPerSide).fill(EMPTY_CELL);
    }

    reserve(centerX: number, centerZ: number, radius: number): void {
        const disc = this.discCount;
        this.growDiscsIfFull();

        this.discCenterX[disc] = centerX;
        this.discCenterZ[disc] = centerZ;
        this.discRadius[disc] = radius;
        this.discCount += 1;

        const firstColumn = this.cellIndexFor(centerX - radius);
        const lastColumn = this.cellIndexFor(centerX + radius);
        const firstRow = this.cellIndexFor(centerZ - radius);
        const lastRow = this.cellIndexFor(centerZ + radius);

        for (let row = firstRow; row <= lastRow; row += 1) {
            for (let column = firstColumn; column <= lastColumn; column += 1) {
                this.linkIntoCell(disc, row * this.cellsPerSide + column);
            }
        }
    }

    reserveLane(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): void {
        const spanX = toX - fromX;
        const spanZ = toZ - fromZ;
        const spanLength = Math.hypot(spanX, spanZ);
        const discCount = Math.max(1, Math.ceil(spanLength / radius));

        for (let step = 0; step <= discCount; step += 1) {
            const alongRatio = step / discCount;
            this.reserve(fromX + spanX * alongRatio, fromZ + spanZ * alongRatio, radius);
        }
    }

    isClear(centerX: number, centerZ: number, radius: number): boolean {
        this.queryStamp += 1;

        const firstColumn = this.cellIndexFor(centerX - radius);
        const lastColumn = this.cellIndexFor(centerX + radius);
        const firstRow = this.cellIndexFor(centerZ - radius);
        const lastRow = this.cellIndexFor(centerZ + radius);

        for (let row = firstRow; row <= lastRow; row += 1) {
            for (let column = firstColumn; column <= lastColumn; column += 1) {
                let entry = this.cellHead[row * this.cellsPerSide + column] ?? EMPTY_CELL;

                while (entry !== EMPTY_CELL) {
                    const disc = this.entryDisc[entry] ?? 0;
                    entry = this.entryNextInCell[entry] ?? EMPTY_CELL;

                    if (this.discVisitedInQuery[disc] === this.queryStamp) continue;
                    this.discVisitedInQuery[disc] = this.queryStamp;

                    const gapX = centerX - (this.discCenterX[disc] ?? 0);
                    const gapZ = centerZ - (this.discCenterZ[disc] ?? 0);
                    const contactDistance = radius + (this.discRadius[disc] ?? 0);

                    if (gapX * gapX + gapZ * gapZ < contactDistance * contactDistance) return false;
                }
            }
        }

        return true;
    }

    private cellIndexFor(coordinate: number): number {
        return clamp(
            Math.floor((coordinate + this.halfSpan) / this.cellSize),
            0,
            this.cellsPerSide - 1
        );
    }

    private linkIntoCell(disc: number, cell: number): void {
        const entry = this.entryCount;
        this.growEntriesIfFull();

        this.entryDisc[entry] = disc;
        this.entryNextInCell[entry] = this.cellHead[cell] ?? EMPTY_CELL;
        this.cellHead[cell] = entry;
        this.entryCount += 1;
    }

    private growDiscsIfFull(): void {
        if (this.discCount < this.discCenterX.length) return;

        const capacity = this.discCenterX.length * 2;
        this.discCenterX = growFloats(this.discCenterX, capacity);
        this.discCenterZ = growFloats(this.discCenterZ, capacity);
        this.discRadius = growFloats(this.discRadius, capacity);
        this.discVisitedInQuery = growIntegers(this.discVisitedInQuery, capacity);
    }

    private growEntriesIfFull(): void {
        if (this.entryCount < this.entryDisc.length) return;

        const capacity = this.entryDisc.length * 2;
        this.entryDisc = growIntegers(this.entryDisc, capacity);
        this.entryNextInCell = growIntegers(this.entryNextInCell, capacity);
    }
}

function growFloats(values: Float32Array, capacity: number): Float32Array {
    const grown = new Float32Array(capacity);
    grown.set(values);

    return grown;
}

function growIntegers(values: Int32Array, capacity: number): Int32Array {
    const grown = new Int32Array(capacity);
    grown.set(values);

    return grown;
}
