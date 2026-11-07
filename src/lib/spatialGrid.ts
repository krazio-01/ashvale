import { clamp } from "@/lib/helpers";

export interface ICellBox {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
}

export class UniformGrid {
    readonly cellCount: number;
    private readonly originX: number;
    private readonly originZ: number;
    private readonly cellSize: number;
    private readonly columns: number;
    private readonly rows: number;

    constructor(extent: Readonly<ICellBox>, cellSize: number) {
        this.originX = extent.minX;
        this.originZ = extent.minZ;
        this.cellSize = cellSize;
        this.columns = Math.max(1, Math.ceil((extent.maxX - extent.minX) / cellSize));
        this.rows = Math.max(1, Math.ceil((extent.maxZ - extent.minZ) / cellSize));
        this.cellCount = this.columns * this.rows;
    }

    cellAt(x: number, z: number): number {
        const column = Math.floor((x - this.originX) / this.cellSize);
        const row = Math.floor((z - this.originZ) / this.cellSize);

        if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return -1;
        return row * this.columns + column;
    }

    someCell(box: Readonly<ICellBox>, visit: (cell: number) => boolean | void): boolean {
        const lastColumn = this.columnOf(box.maxX);
        const lastRow = this.rowOf(box.maxZ);

        for (let row = this.rowOf(box.minZ); row <= lastRow; row += 1)
            for (let column = this.columnOf(box.minX); column <= lastColumn; column += 1)
                if (visit(row * this.columns + column) === true) return true;
        return false;
    }

    private columnOf(x: number): number {
        return clamp(Math.floor((x - this.originX) / this.cellSize), 0, this.columns - 1);
    }

    private rowOf(z: number): number {
        return clamp(Math.floor((z - this.originZ) / this.cellSize), 0, this.rows - 1);
    }
}

export class CellIndex {
    private readonly grid: UniformGrid;
    private readonly cellStarts: Int32Array;
    private readonly cellItems: Int32Array;

    constructor(
        cellSize: number,
        extent: Readonly<ICellBox>,
        itemCount: number,
        fillItemBox: (item: number, box: ICellBox) => void
    ) {
        this.grid = new UniformGrid(
            {
                minX: extent.minX - cellSize,
                minZ: extent.minZ - cellSize,
                maxX: extent.maxX + cellSize * 2,
                maxZ: extent.maxZ + cellSize * 2,
            },
            cellSize
        );

        const box: ICellBox = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
        const cellStarts = new Int32Array(this.grid.cellCount + 1);

        for (let item = 0; item < itemCount; item += 1) {
            fillItemBox(item, box);
            this.grid.someCell(box, (cell) => {
                cellStarts[cell + 1] += 1;
            });
        }

        for (let cell = 0; cell < cellStarts.length - 1; cell += 1)
            cellStarts[cell + 1] += cellStarts[cell];

        const cellItems = new Int32Array(cellStarts[cellStarts.length - 1]);
        const fillCursor = Int32Array.from(cellStarts.subarray(0, cellStarts.length - 1));

        for (let item = 0; item < itemCount; item += 1) {
            fillItemBox(item, box);
            this.grid.someCell(box, (cell) => {
                cellItems[fillCursor[cell]] = item;
                fillCursor[cell] += 1;
            });
        }

        this.cellStarts = cellStarts;
        this.cellItems = cellItems;
    }

    cellAt(x: number, z: number): number {
        return this.grid.cellAt(x, z);
    }

    startOf(cell: number): number {
        return this.cellStarts[cell];
    }

    endOf(cell: number): number {
        return this.cellStarts[cell + 1];
    }

    itemAt(cursor: number): number {
        return this.cellItems[cursor];
    }
}
