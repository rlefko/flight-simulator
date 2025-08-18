import { Vector3 } from '../core/math/Vector3';
import { Quaternion } from '../core/math/Quaternion';
import { Matrix4 } from '../core/math/Matrix4';

/**
 * 6DOF Rigid Body Dynamics
 * Implements Newton-Euler equations for rigid body motion
 */
export class RigidBody {
    // State variables
    public position: Vector3;
    public velocity: Vector3;
    public acceleration: Vector3;
    public orientation: Quaternion;
    public angularVelocity: Vector3;
    public angularAcceleration: Vector3;

    // Mass properties
    public mass: number;
    public inverseMass: number;
    public inertiaTensor: Matrix4;
    public inverseInertiaTensor: Matrix4;
    public centerOfGravity: Vector3;

    // Forces and moments
    private forces: Vector3;
    private moments: Vector3;

    // Transformation matrices
    public transformMatrix: Matrix4;
    public inverseTransformMatrix: Matrix4;

    constructor(mass: number = 1000) {
        // Initialize state
        this.position = new Vector3(0, 0, 0);
        this.velocity = new Vector3(0, 0, 0);
        this.acceleration = new Vector3(0, 0, 0);
        this.orientation = new Quaternion(0, 0, 0, 1);
        this.angularVelocity = new Vector3(0, 0, 0);
        this.angularAcceleration = new Vector3(0, 0, 0);

        // Initialize mass properties
        this.mass = mass;
        this.inverseMass = mass > 0 ? 1 / mass : 0;
        this.centerOfGravity = new Vector3(0, 0, 0);

        // Initialize inertia tensor (will be set by aircraft configuration)
        this.inertiaTensor = new Matrix4();
        this.inverseInertiaTensor = new Matrix4();

        // Initialize forces
        this.forces = new Vector3(0, 0, 0);
        this.moments = new Vector3(0, 0, 0);

        // Initialize transformation matrices
        this.transformMatrix = new Matrix4();
        this.inverseTransformMatrix = new Matrix4();

        this.updateTransformMatrix();
    }

    /**
     * Set the inertia tensor for the rigid body
     * @param ixx Moment of inertia about x-axis
     * @param iyy Moment of inertia about y-axis
     * @param izz Moment of inertia about z-axis
     * @param ixy Product of inertia xy
     * @param ixz Product of inertia xz
     * @param iyz Product of inertia yz
     */
    public setInertiaTensor(
        ixx: number,
        iyy: number,
        izz: number,
        ixy: number = 0,
        ixz: number = 0,
        iyz: number = 0
    ): void {
        this.inertiaTensor.set(
            ixx, -ixy, -ixz, 0,
            -ixy, iyy, -iyz, 0,
            -ixz, -iyz, izz, 0,
            0, 0, 0, 1
        );
        this.inverseInertiaTensor.copy(this.inertiaTensor).invert();
    }

    /**
     * Clear all forces and moments
     */
    public clearForces(): void {
        this.forces.set(0, 0, 0);
        this.moments.set(0, 0, 0);
    }

    /**
     * Apply a force at a point (in body coordinates)
     * @param force Force vector in body coordinates
     * @param point Point of application in body coordinates
     */
    public applyForceAtPoint(force: Vector3, point: Vector3): void {
        this.forces.add(force);
        
        // Calculate moment: r × F
        const moment = new Vector3()
            .copy(point)
            .sub(this.centerOfGravity)
            .cross(force);
        this.moments.add(moment);
    }

    /**
     * Apply a force at the center of gravity
     * @param force Force vector in body coordinates
     */
    public applyForce(force: Vector3): void {
        this.forces.add(force);
    }

    /**
     * Apply a moment/torque
     * @param moment Moment vector in body coordinates
     */
    public applyMoment(moment: Vector3): void {
        this.moments.add(moment);
    }

    /**
     * Transform force from world to body coordinates
     * @param worldForce Force in world coordinates
     * @returns Force in body coordinates
     */
    public worldToBodyForce(worldForce: Vector3): Vector3 {
        const bodyForce = new Vector3();
        const e = this.inverseTransformMatrix.elements;
        
        bodyForce.x = e[0] * worldForce.x + e[4] * worldForce.y + e[8] * worldForce.z;
        bodyForce.y = e[1] * worldForce.x + e[5] * worldForce.y + e[9] * worldForce.z;
        bodyForce.z = e[2] * worldForce.x + e[6] * worldForce.y + e[10] * worldForce.z;
        
        return bodyForce;
    }

    /**
     * Transform force from body to world coordinates
     * @param bodyForce Force in body coordinates
     * @returns Force in world coordinates
     */
    public bodyToWorldForce(bodyForce: Vector3): Vector3 {
        const worldForce = new Vector3();
        const e = this.transformMatrix.elements;
        
        worldForce.x = e[0] * bodyForce.x + e[4] * bodyForce.y + e[8] * bodyForce.z;
        worldForce.y = e[1] * bodyForce.x + e[5] * bodyForce.y + e[9] * bodyForce.z;
        worldForce.z = e[2] * bodyForce.x + e[6] * bodyForce.y + e[10] * bodyForce.z;
        
        return worldForce;
    }

    /**
     * Update transformation matrix from orientation
     */
    private updateTransformMatrix(): void {
        const scale = new Vector3(1, 1, 1);
        this.transformMatrix.compose(this.position, this.orientation, scale);
        this.inverseTransformMatrix.copy(this.transformMatrix).invert();
    }

    /**
     * Integrate rigid body dynamics using RK4 method
     * @param dt Time step in seconds
     */
    public integrate(dt: number): void {
        if (this.inverseMass === 0) return; // Static body

        // RK4 integration for position and velocity
        const k1_v = this.acceleration.clone();
        const k1_p = this.velocity.clone();

        const v2 = this.velocity.clone().add(k1_v.clone().multiplyScalar(dt * 0.5));
        const k2_v = this.acceleration.clone();
        const k2_p = v2;

        const v3 = this.velocity.clone().add(k2_v.clone().multiplyScalar(dt * 0.5));
        const k3_v = this.acceleration.clone();
        const k3_p = v3;

        const v4 = this.velocity.clone().add(k3_v.clone().multiplyScalar(dt));
        const k4_v = this.acceleration.clone();
        const k4_p = v4;

        // Update velocity
        this.velocity.add(
            k1_v.multiplyScalar(dt / 6)
                .add(k2_v.multiplyScalar(dt / 3))
                .add(k3_v.multiplyScalar(dt / 3))
                .add(k4_v.multiplyScalar(dt / 6))
        );

        // Update position
        this.position.add(
            k1_p.multiplyScalar(dt / 6)
                .add(k2_p.multiplyScalar(dt / 3))
                .add(k3_p.multiplyScalar(dt / 3))
                .add(k4_p.multiplyScalar(dt / 6))
        );

        // Integrate angular motion (simplified for stability)
        this.integrateAngular(dt);

        // Update transformation matrix
        this.updateTransformMatrix();
    }

    /**
     * Integrate angular motion
     * @param dt Time step in seconds
     */
    private integrateAngular(dt: number): void {
        // Update angular velocity from angular acceleration
        this.angularVelocity.add(
            this.angularAcceleration.clone().multiplyScalar(dt)
        );

        // Create quaternion from angular velocity
        const angle = this.angularVelocity.length() * dt;
        if (angle > 0.0001) {
            const axis = this.angularVelocity.clone().normalize();
            const deltaQ = new Quaternion().setFromAxisAngle(axis, angle);
            
            // Update orientation
            this.orientation.multiply(deltaQ).normalize();
        }
    }

    /**
     * Update accelerations from forces and moments
     */
    public updateAccelerations(): void {
        // Linear acceleration: F = ma -> a = F/m
        if (this.inverseMass > 0) {
            // Transform forces to world coordinates
            const worldForces = this.bodyToWorldForce(this.forces);
            this.acceleration.copy(worldForces).multiplyScalar(this.inverseMass);
        }

        // Angular acceleration: M = Iα -> α = I^-1 * M
        if (this.inverseInertiaTensor) {
            const e = this.inverseInertiaTensor.elements;
            const mx = this.moments.x;
            const my = this.moments.y;
            const mz = this.moments.z;

            this.angularAcceleration.set(
                e[0] * mx + e[4] * my + e[8] * mz,
                e[1] * mx + e[5] * my + e[9] * mz,
                e[2] * mx + e[6] * my + e[10] * mz
            );
        }
    }

    /**
     * Get the velocity at a point on the body (includes rotational component)
     * @param point Point in body coordinates
     * @returns Velocity at the point in world coordinates
     */
    public getVelocityAtPoint(point: Vector3): Vector3 {
        // v_point = v_cm + ω × r
        const r = point.clone().sub(this.centerOfGravity);
        const rotationalVelocity = this.angularVelocity.clone().cross(r);
        const worldRotVel = this.bodyToWorldForce(rotationalVelocity);
        
        return this.velocity.clone().add(worldRotVel);
    }

    /**
     * Reset the rigid body to initial state
     */
    public reset(): void {
        this.position.set(0, 0, 0);
        this.velocity.set(0, 0, 0);
        this.acceleration.set(0, 0, 0);
        this.orientation.set(0, 0, 0, 1);
        this.angularVelocity.set(0, 0, 0);
        this.angularAcceleration.set(0, 0, 0);
        this.clearForces();
        this.updateTransformMatrix();
    }

    /**
     * Get Euler angles from orientation quaternion
     * @returns Object with roll, pitch, yaw in radians
     */
    public getEulerAngles(): { roll: number; pitch: number; yaw: number } {
        const q = this.orientation;
        const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
        const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
        const roll = Math.atan2(sinr_cosp, cosr_cosp);

        const sinp = 2 * (q.w * q.y - q.z * q.x);
        const pitch = Math.abs(sinp) >= 1 
            ? Math.sign(sinp) * Math.PI / 2 
            : Math.asin(sinp);

        const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
        const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
        const yaw = Math.atan2(siny_cosp, cosy_cosp);

        return { roll, pitch, yaw };
    }

    /**
     * Set orientation from Euler angles
     * @param roll Roll angle in radians
     * @param pitch Pitch angle in radians
     * @param yaw Yaw angle in radians
     */
    public setEulerAngles(roll: number, pitch: number, yaw: number): void {
        this.orientation.setFromEuler(roll, pitch, yaw, 'YXZ');
        this.updateTransformMatrix();
    }
}