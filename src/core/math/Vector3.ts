export class Vector3 {
    constructor(
        public x: number = 0,
        public y: number = 0,
        public z: number = 0
    ) {}

    static readonly ZERO = new Vector3(0, 0, 0);
    static readonly ONE = new Vector3(1, 1, 1);
    static readonly UP = new Vector3(0, 1, 0);
    static readonly DOWN = new Vector3(0, -1, 0);
    static readonly LEFT = new Vector3(-1, 0, 0);
    static readonly RIGHT = new Vector3(1, 0, 0);
    static readonly FORWARD = new Vector3(0, 0, -1);
    static readonly BACKWARD = new Vector3(0, 0, 1);

    set(x: number, y: number, z: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    copy(v: Vector3): this {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
    }

    clone(): Vector3 {
        return new Vector3(this.x, this.y, this.z);
    }

    add(v: Vector3): this {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
    }

    addScalar(s: number): this {
        this.x += s;
        this.y += s;
        this.z += s;
        return this;
    }

    sub(v: Vector3): this {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        return this;
    }

    multiply(v: Vector3): this {
        this.x *= v.x;
        this.y *= v.y;
        this.z *= v.z;
        return this;
    }

    multiplyScalar(s: number): this {
        this.x *= s;
        this.y *= s;
        this.z *= s;
        return this;
    }

    divide(v: Vector3): this {
        this.x /= v.x;
        this.y /= v.y;
        this.z /= v.z;
        return this;
    }

    divideScalar(s: number): this {
        return this.multiplyScalar(1 / s);
    }

    dot(v: Vector3): number {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }

    cross(v: Vector3): this {
        const x = this.y * v.z - this.z * v.y;
        const y = this.z * v.x - this.x * v.z;
        const z = this.x * v.y - this.y * v.x;
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    lengthSq(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    normalize(): this {
        return this.divideScalar(this.length() || 1);
    }

    distanceTo(v: Vector3): number {
        return Math.sqrt(this.distanceToSq(v));
    }

    distanceToSq(v: Vector3): number {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        const dz = this.z - v.z;
        return dx * dx + dy * dy + dz * dz;
    }

    lerp(v: Vector3, alpha: number): this {
        this.x += (v.x - this.x) * alpha;
        this.y += (v.y - this.y) * alpha;
        this.z += (v.z - this.z) * alpha;
        return this;
    }

    equals(v: Vector3, epsilon = 0.000001): boolean {
        return (
            Math.abs(this.x - v.x) < epsilon &&
            Math.abs(this.y - v.y) < epsilon &&
            Math.abs(this.z - v.z) < epsilon
        );
    }

    toArray(): [number, number, number] {
        return [this.x, this.y, this.z];
    }

    fromArray(array: number[], offset = 0): this {
        this.x = array[offset];
        this.y = array[offset + 1];
        this.z = array[offset + 2];
        return this;
    }
}