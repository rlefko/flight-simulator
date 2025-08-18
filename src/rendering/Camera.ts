import { Matrix4, Vector3, Quaternion, DEG_TO_RAD, clamp, lerp } from '../core/math';

export interface CameraConfiguration {
    fov: number;
    near: number;
    far: number;
    aspectRatio: number;
}

export interface FlightCameraControls {
    panSensitivity: number;
    tiltSensitivity: number;
    zoomSensitivity: number;
    smoothingFactor: number;
    invertY: boolean;
    maxTiltAngle: number;
    minDistance: number;
    maxDistance: number;
}

export interface ViewFrustum {
    left: number;
    right: number;
    top: number;
    bottom: number;
    near: number;
    far: number;
    planes: Float32Array[]; // 6 frustum planes for culling
}

export enum CameraMode {
    COCKPIT = 'cockpit',
    EXTERNAL = 'external',
    CHASE = 'chase',
    TOWER = 'tower',
    FLYBY = 'flyby',
    FREE = 'free',
}

export class Camera {
    // Core camera properties
    private position = new Vector3(4096, 500, 4096); // Center of tile (0,0)
    private target = new Vector3(4096, 0, 4096); // Look at ground below
    private up = new Vector3(0, 1, 0); // Y is up
    private forward = new Vector3(0, 0, -1);
    private right = new Vector3(1, 0, 0);

    // Free camera rotation
    // In our coordinate system: yaw=0 means looking along +Z axis
    // Yaw increases counterclockwise when viewed from above
    private yaw = 0; // Start facing +Z
    private pitch = -0.7; // Looking down more steeply to see terrain below

    // Matrices
    private viewMatrix = new Matrix4();
    private projectionMatrix = new Matrix4();
    private viewProjectionMatrix = new Matrix4();
    private inverseViewMatrix = new Matrix4();
    private inverseProjectionMatrix = new Matrix4();

    // Configuration
    private config: CameraConfiguration;
    private controls: FlightCameraControls;
    private mode = CameraMode.FREE; // Start in free mode

    // View frustum for culling
    private frustum: ViewFrustum;

    // Smooth interpolation
    private targetPosition = new Vector3();
    private targetTarget = new Vector3();
    private currentVelocity = new Vector3();
    private targetVelocity = new Vector3();

    // Flight-specific properties
    private bankAngle = 0; // Roll angle for flight dynamics
    private pitchAngle = 0;
    private yawAngle = 0;

    // External camera properties (chase/orbit)
    private distance = 50;
    private elevation = 10; // Degrees above horizon
    private azimuth = 0; // Degrees around target

    // Shake/vibration effects
    private shakeIntensity = 0;
    private shakeDecay = 0.95;
    private shakeOffset = new Vector3();

    private isDirty = true;

    constructor(aspectRatio: number) {
        this.config = {
            fov: 90 * DEG_TO_RAD, // 90 degree FOV as requested
            near: 1.0, // Increased to reduce z-fighting
            far: 100000, // 100km view distance for terrain
            aspectRatio,
        };

        this.controls = {
            panSensitivity: 0.005,
            tiltSensitivity: 0.005,
            zoomSensitivity: 0.1,
            smoothingFactor: 0.1,
            invertY: false,
            maxTiltAngle: 89 * DEG_TO_RAD,
            minDistance: 5,
            maxDistance: 1000,
        };

        this.frustum = {
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            near: this.config.near,
            far: this.config.far,
            planes: new Array(6).fill(null).map(() => new Float32Array(4)),
        };

        this.targetPosition.copy(this.position);
        this.targetTarget.copy(this.target);

        // Initialize free camera vectors properly
        this.updateFreeCameraVectors();
        this.updateMatrices();
    }

    update(deltaTime: number): void {
        if (this.mode === CameraMode.EXTERNAL || this.mode === CameraMode.CHASE) {
            this.updateExternalCamera(deltaTime);
            this.updateSmoothMovement(deltaTime);
        } else if (this.mode === CameraMode.FREE) {
            // In free mode, don't use smoothing - direct control
            this.isDirty = true;
        } else {
            this.updateSmoothMovement(deltaTime);
        }

        this.updateShake(deltaTime);

        if (this.isDirty) {
            this.updateMatrices();
            this.updateFrustum();
            this.isDirty = false;
        }
    }

    private updateExternalCamera(deltaTime: number): void {
        // Calculate orbital position around target
        const elevationRad = this.elevation * DEG_TO_RAD;
        const azimuthRad = this.azimuth * DEG_TO_RAD;

        const horizontalDistance = this.distance * Math.cos(elevationRad);
        const height = this.distance * Math.sin(elevationRad);

        this.targetPosition.set(
            this.target.x + horizontalDistance * Math.sin(azimuthRad),
            this.target.y + height,
            this.target.z + horizontalDistance * Math.cos(azimuthRad)
        );
    }

    private updateSmoothMovement(deltaTime: number): void {
        // Smooth position interpolation
        const positionDelta = Vector3.subtract(this.targetPosition, this.position);
        const smoothedDelta = Vector3.multiplyScalar(
            positionDelta,
            this.controls.smoothingFactor * deltaTime * 60
        );
        this.position.add(smoothedDelta);

        // Smooth target interpolation
        const targetDelta = Vector3.subtract(this.targetTarget, this.target);
        const smoothedTargetDelta = Vector3.multiplyScalar(
            targetDelta,
            this.controls.smoothingFactor * deltaTime * 60
        );
        this.target.add(smoothedTargetDelta);

        this.isDirty = true;
    }

    private updateShake(deltaTime: number): void {
        if (this.shakeIntensity > 0.001) {
            // Generate random shake offset
            this.shakeOffset.set(
                (Math.random() - 0.5) * this.shakeIntensity,
                (Math.random() - 0.5) * this.shakeIntensity,
                (Math.random() - 0.5) * this.shakeIntensity
            );

            this.shakeIntensity *= this.shakeDecay;
        } else {
            this.shakeOffset.set(0, 0, 0);
            this.shakeIntensity = 0;
        }
    }

    private updateMatrices(): void {
        // Apply shake to final position
        const shakenPosition = Vector3.add(this.position, this.shakeOffset);

        // In free camera mode, we already have the correct forward/right/up vectors
        // from updateFreeCameraVectors(), so don't recalculate them
        if (this.mode !== CameraMode.FREE) {
            // Update view vectors for other modes
            this.forward = Vector3.subtract(this.target, shakenPosition).normalize();
            this.right = Vector3.cross(this.forward, this.up).normalize();
            this.up = Vector3.cross(this.right, this.forward).normalize();
        }

        // Build view matrix
        this.viewMatrix.identity();

        if (this.mode === CameraMode.FREE) {
            // Build view matrix directly from camera basis vectors
            // This is the standard approach for FPS-style cameras
            // View matrix = [Right, Up, -Forward]^T * Translation

            const e = this.viewMatrix.elements;

            // Set rotation part (transposed basis vectors)
            e[0] = this.right.x;
            e[1] = this.up.x;
            e[2] = -this.forward.x; // Note: negative forward for right-handed coordinates
            e[3] = 0;

            e[4] = this.right.y;
            e[5] = this.up.y;
            e[6] = -this.forward.y;
            e[7] = 0;

            e[8] = this.right.z;
            e[9] = this.up.z;
            e[10] = -this.forward.z;
            e[11] = 0;

            // Set translation part (dot products with basis vectors)
            e[12] = -this.right.dot(shakenPosition);
            e[13] = -this.up.dot(shakenPosition);
            e[14] = this.forward.dot(shakenPosition); // Positive because forward is already negated
            e[15] = 1;
        } else {
            // For other modes, use the actual target
            this.viewMatrix.lookAt(shakenPosition, this.target, this.up);
        }

        // Build projection matrix
        this.projectionMatrix.identity();
        this.projectionMatrix.perspective(
            this.config.fov,
            this.config.aspectRatio,
            this.config.near,
            this.config.far
        );

        // Combine matrices
        this.viewProjectionMatrix = Matrix4.multiply(this.projectionMatrix, this.viewMatrix);

        // Calculate inverse matrices for various rendering needs
        this.inverseViewMatrix = this.viewMatrix.clone().invert();
        this.inverseProjectionMatrix = this.projectionMatrix.clone().invert();
    }

    private updateFrustum(): void {
        // Extract frustum planes from view-projection matrix
        const m = this.viewProjectionMatrix.elements;

        // Left plane
        this.frustum.planes[0][0] = m[3] + m[0];
        this.frustum.planes[0][1] = m[7] + m[4];
        this.frustum.planes[0][2] = m[11] + m[8];
        this.frustum.planes[0][3] = m[15] + m[12];

        // Right plane
        this.frustum.planes[1][0] = m[3] - m[0];
        this.frustum.planes[1][1] = m[7] - m[4];
        this.frustum.planes[1][2] = m[11] - m[8];
        this.frustum.planes[1][3] = m[15] - m[12];

        // Bottom plane
        this.frustum.planes[2][0] = m[3] + m[1];
        this.frustum.planes[2][1] = m[7] + m[5];
        this.frustum.planes[2][2] = m[11] + m[9];
        this.frustum.planes[2][3] = m[15] + m[13];

        // Top plane
        this.frustum.planes[3][0] = m[3] - m[1];
        this.frustum.planes[3][1] = m[7] - m[5];
        this.frustum.planes[3][2] = m[11] - m[9];
        this.frustum.planes[3][3] = m[15] - m[13];

        // Near plane
        this.frustum.planes[4][0] = m[3] + m[2];
        this.frustum.planes[4][1] = m[7] + m[6];
        this.frustum.planes[4][2] = m[11] + m[10];
        this.frustum.planes[4][3] = m[15] + m[14];

        // Far plane
        this.frustum.planes[5][0] = m[3] - m[2];
        this.frustum.planes[5][1] = m[7] - m[6];
        this.frustum.planes[5][2] = m[11] - m[10];
        this.frustum.planes[5][3] = m[15] - m[14];

        // Normalize all planes
        for (let i = 0; i < 6; i++) {
            const plane = this.frustum.planes[i];
            const length = Math.sqrt(
                plane[0] * plane[0] + plane[1] * plane[1] + plane[2] * plane[2]
            );
            plane[0] /= length;
            plane[1] /= length;
            plane[2] /= length;
            plane[3] /= length;
        }

        // Update frustum bounds for AABB tests
        const tanFov = Math.tan(this.config.fov * 0.5);
        this.frustum.top = this.config.near * tanFov;
        this.frustum.bottom = -this.frustum.top;
        this.frustum.right = this.frustum.top * this.config.aspectRatio;
        this.frustum.left = -this.frustum.right;
    }

    // Camera controls
    setPosition(position: Vector3): void {
        this.targetPosition.copy(position);
        this.isDirty = true;
    }

    setTarget(target: Vector3): void {
        this.targetTarget.copy(target);
        this.isDirty = true;
    }

    setMode(mode: CameraMode): void {
        this.mode = mode;
        this.isDirty = true;
    }

    // External camera controls
    orbit(deltaAzimuth: number, deltaElevation: number): void {
        this.azimuth += deltaAzimuth * this.controls.panSensitivity;
        this.elevation +=
            deltaElevation * this.controls.tiltSensitivity * (this.controls.invertY ? -1 : 1);

        // Clamp elevation to prevent flipping
        this.elevation = clamp(
            this.elevation,
            -this.controls.maxTiltAngle * (180 / Math.PI),
            this.controls.maxTiltAngle * (180 / Math.PI)
        );

        // Wrap azimuth
        this.azimuth = ((this.azimuth % 360) + 360) % 360;

        this.isDirty = true;
    }

    zoom(delta: number): void {
        this.distance *= 1 + delta * this.controls.zoomSensitivity;
        this.distance = clamp(this.distance, this.controls.minDistance, this.controls.maxDistance);
        this.isDirty = true;
    }

    // Flight-specific methods
    setFlightAngles(pitch: number, yaw: number, bank: number): void {
        this.pitchAngle = pitch;
        this.yawAngle = yaw;
        this.bankAngle = bank;

        // Update camera up vector based on bank angle for realistic flight feel
        if (this.mode === CameraMode.COCKPIT || this.mode === CameraMode.CHASE) {
            const bankRad = bank * DEG_TO_RAD;
            this.up.set(Math.sin(bankRad), Math.cos(bankRad), 0);
            this.isDirty = true;
        }
    }

    addShake(intensity: number): void {
        this.shakeIntensity = Math.min(this.shakeIntensity + intensity, 5.0);
    }

    // Configuration
    setFOV(fov: number): void {
        this.config.fov = fov * DEG_TO_RAD;
        this.isDirty = true;
    }

    setAspectRatio(aspectRatio: number): void {
        this.config.aspectRatio = aspectRatio;
        this.isDirty = true;
    }

    setNearFar(near: number, far: number): void {
        this.config.near = near;
        this.config.far = far;
        this.frustum.near = near;
        this.frustum.far = far;
        this.isDirty = true;
    }

    // Frustum culling
    isPointInFrustum(point: Vector3): boolean {
        for (let i = 0; i < 6; i++) {
            const plane = this.frustum.planes[i];
            const distance =
                plane[0] * point.x + plane[1] * point.y + plane[2] * point.z + plane[3];
            if (distance < 0) return false;
        }
        return true;
    }

    isSphereInFrustum(center: Vector3, radius: number): boolean {
        for (let i = 0; i < 6; i++) {
            const plane = this.frustum.planes[i];
            const distance =
                plane[0] * center.x + plane[1] * center.y + plane[2] * center.z + plane[3];
            if (distance < -radius) return false;
        }
        return true;
    }

    isAABBInFrustum(min: Vector3, max: Vector3): boolean {
        for (let i = 0; i < 6; i++) {
            const plane = this.frustum.planes[i];

            // Find the positive vertex (the vertex most aligned with the plane normal)
            const positiveVertex = new Vector3(
                plane[0] >= 0 ? max.x : min.x,
                plane[1] >= 0 ? max.y : min.y,
                plane[2] >= 0 ? max.z : min.z
            );

            // If the positive vertex is outside the plane, the box is outside
            const distance =
                plane[0] * positiveVertex.x +
                plane[1] * positiveVertex.y +
                plane[2] * positiveVertex.z +
                plane[3];
            if (distance < 0) return false;
        }
        return true;
    }

    // Screen-space projection
    worldToScreen(worldPos: Vector3, screenWidth: number, screenHeight: number): Vector3 {
        const clipPos = this.viewProjectionMatrix.multiplyVector4([
            worldPos.x,
            worldPos.y,
            worldPos.z,
            1,
        ]);

        if (clipPos[3] <= 0) {
            return new Vector3(-1, -1, -1); // Behind camera
        }

        const ndcPos = [clipPos[0] / clipPos[3], clipPos[1] / clipPos[3], clipPos[2] / clipPos[3]];

        const screenPos = new Vector3(
            (ndcPos[0] + 1) * 0.5 * screenWidth,
            (1 - ndcPos[1]) * 0.5 * screenHeight,
            ndcPos[2]
        );

        return screenPos;
    }

    screenToWorld(screenPos: Vector3, screenWidth: number, screenHeight: number): Vector3 {
        const ndcPos = [
            (screenPos.x / screenWidth) * 2 - 1,
            1 - (screenPos.y / screenHeight) * 2,
            screenPos.z * 2 - 1,
            1,
        ];

        const worldPos = this.inverseViewMatrix.multiplyVector4(
            this.inverseProjectionMatrix.multiplyVector4(ndcPos)
        );

        if (worldPos[3] !== 0) {
            return new Vector3(
                worldPos[0] / worldPos[3],
                worldPos[1] / worldPos[3],
                worldPos[2] / worldPos[3]
            );
        }

        return new Vector3(0, 0, 0);
    }

    // Getters
    getPosition(): Vector3 {
        return this.position.clone();
    }
    getTarget(): Vector3 {
        return this.target.clone();
    }
    getForward(): Vector3 {
        return this.forward.clone();
    }
    getRight(): Vector3 {
        return this.right.clone();
    }
    getUp(): Vector3 {
        return this.up.clone();
    }

    getViewMatrix(): Matrix4 {
        return this.viewMatrix.clone();
    }
    getProjectionMatrix(): Matrix4 {
        return this.projectionMatrix.clone();
    }
    getViewProjectionMatrix(): Matrix4 {
        return this.viewProjectionMatrix.clone();
    }
    getInverseViewMatrix(): Matrix4 {
        return this.inverseViewMatrix.clone();
    }

    getFrustum(): ViewFrustum {
        return { ...this.frustum };
    }
    getMode(): CameraMode {
        return this.mode;
    }
    getConfiguration(): CameraConfiguration {
        return { ...this.config };
    }
    getControls(): FlightCameraControls {
        return { ...this.controls };
    }

    // Distance and angle getters for external camera
    getDistance(): number {
        return this.distance;
    }
    getElevation(): number {
        return this.elevation;
    }
    getAzimuth(): number {
        return this.azimuth;
    }

    // Flight angles
    getPitchAngle(): number {
        return this.pitchAngle;
    }
    getYawAngle(): number {
        return this.yawAngle;
    }
    getBankAngle(): number {
        return this.bankAngle;
    }

    // Free camera controls
    setYaw(yaw: number): void {
        this.yaw = yaw;
        this.updateFreeCameraVectors();
    }

    setPitch(pitch: number): void {
        // Clamp pitch to prevent flipping
        this.pitch = clamp(pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
        this.updateFreeCameraVectors();
    }

    rotate(deltaYaw: number, deltaPitch: number): void {
        this.changeYaw(deltaYaw);
        this.changePitch(deltaPitch);
    }

    // Legacy compatibility methods
    moveForward(distance: number): void {
        this.goForward(distance);
    }

    moveRight(distance: number): void {
        this.strafe(-distance); // Negative because strafe goes left with positive
    }

    moveUp(distance: number): void {
        this.changeAltitude(distance);
    }

    // Movement methods matching C++ camera style
    goForward(distance: number): void {
        // Calculate forward direction from yaw only (ignore pitch for horizontal movement)
        // This keeps movement on the XZ plane
        const xDirection = Math.sin(this.yaw);
        const zDirection = Math.cos(this.yaw);
        const viewDirection = new Vector3(xDirection, 0, zDirection);
        this.position.add(viewDirection.multiplyScalar(distance));
    }

    strafe(distance: number): void {
        // Strafe uses the right vector we already calculated
        // In C++: strafeAxis = cross(viewDirection, Vec3(0, 1, 0))
        // But we already have this as our 'right' vector
        this.position.add(this.right.clone().multiplyScalar(distance));
    }

    changeAltitude(distance: number): void {
        this.position.y += distance;
    }

    changeYaw(delta: number): void {
        // Yaw is always rotation around world Y axis, independent of pitch
        this.yaw += delta;
        // Normalize yaw to [0, 2π]
        while (this.yaw < 0) this.yaw += 2 * Math.PI;
        while (this.yaw >= 2 * Math.PI) this.yaw -= 2 * Math.PI;
        this.updateFreeCameraVectors();
        this.isDirty = true;
    }

    changePitch(delta: number): void {
        this.pitch += delta;
        // Clamp pitch to prevent flipping (with small padding like in C++)
        const padding = 0.05;
        this.pitch = clamp(this.pitch, -Math.PI / 2 + padding, Math.PI / 2 - padding);
        this.updateFreeCameraVectors();
        this.isDirty = true;
    }

    private updateFreeCameraVectors(): void {
        // Calculate forward vector from yaw and pitch (matching C++ exactly)
        this.forward
            .set(
                Math.sin(this.yaw) * Math.cos(this.pitch),
                Math.sin(this.pitch),
                Math.cos(this.yaw) * Math.cos(this.pitch)
            )
            .normalize();

        // Right vector is cross product of forward and world up
        // In a right-handed coordinate system: right = forward × up
        const worldUp = new Vector3(0, 1, 0);
        this.right = Vector3.cross(this.forward, worldUp).normalize();

        // Up vector from right cross forward
        // This ensures orthogonality even when looking up/down
        this.up = Vector3.cross(this.right, this.forward).normalize();

        // Mark as dirty to update matrices
        this.isDirty = true;
    }

    setFreeCamera(): void {
        this.mode = CameraMode.FREE;
        this.updateFreeCameraVectors();
    }

    getYaw(): number {
        return this.yaw;
    }
    getPitch(): number {
        return this.pitch;
    }
}
