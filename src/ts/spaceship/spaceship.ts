//  This file is part of Cosmos Journeyer
//
//  Copyright (C) 2024 Barthélemy Paléologue <barth.paleologue@cosmosjourneyer.com>
//
//  This program is free software: you can redistribute it and/or modify
//  it under the terms of the GNU Affero General Public License as published by
//  the Free Software Foundation, either version 3 of the License, or
//  (at your option) any later version.
//
//  This program is distributed in the hope that it will be useful,
//  but WITHOUT ANY WARRANTY; without even the implied warranty of
//  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//  GNU Affero General Public License for more details.
//
//  You should have received a copy of the GNU Affero General Public License
//  along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { WarpDrive } from "./warpDrive";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { IPhysicsCollisionEvent, PhysicsMotionType, PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsShapeMesh } from "@babylonjs/core/Physics/v2/physicsShape";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Observable } from "@babylonjs/core/Misc/observable";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { setEnabledBody } from "../utils/havok";
import { getForwardDirection, getUpwardDirection, rotate, setRotationQuaternion, translate } from "../uberCore/transforms/basicTransform";
import { TransformNode } from "@babylonjs/core/Meshes";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import { CollisionMask, Settings } from "../settings";
import { Transformable } from "../architecture/transformable";
import { WarpTunnel } from "../utils/warpTunnel";
import { Quaternion } from "@babylonjs/core/Maths/math";
import { PhysicsEngineV2 } from "@babylonjs/core/Physics/v2";
import { HyperSpaceTunnel } from "../utils/hyperSpaceTunnel";
import { AudioInstance } from "../utils/audioInstance";
import { AudioManager } from "../audio/audioManager";
import { Thruster } from "./thruster";
import { AudioMasks } from "../audio/audioMasks";
import { Objects } from "../assets/objects";
import { Sounds } from "../assets/sounds";
import { LandingPad } from "../assets/procedural/landingPad/landingPad";
import { createNotification, NotificationIntent, NotificationOrigin } from "../utils/notification";
import { OrbitalObject, OrbitalObjectType } from "../architecture/orbitalObject";
import { CelestialBody } from "../architecture/celestialBody";
import { HasBoundingSphere } from "../architecture/hasBoundingSphere";
import { FuelTank, SerializedFuelTank } from "./fuelTank";
import { FuelScoop } from "./fuelScoop";

const enum ShipState {
    FLYING,
    LANDING,
    LANDED
}

export const enum ShipType {
    WANDERER
}

export type SerializedSpaceship = {
    name: string;
    type: ShipType;
    fuelTanks: SerializedFuelTank[];
    fuelScoop: FuelScoop | null;
};

export const DefaultSerializedSpaceship: SerializedSpaceship = {
    name: "Wanderer",
    type: ShipType.WANDERER,
    fuelTanks: [{ currentFuel: 100, maxFuel: 100 }],
    fuelScoop: {
        fuelPerSecond: 2.5
    }
};

export class Spaceship implements Transformable {
    readonly name: string;

    readonly instanceRoot: AbstractMesh;

    readonly aggregate: PhysicsAggregate;
    private readonly collisionObservable: Observable<IPhysicsCollisionEvent>;

    private readonly warpDrive = new WarpDrive(false);

    private mainEngineThrottle = 0;
    private mainEngineTargetSpeed = 0;

    private readonly thrusterForce = 8000;

    readonly maxRollSpeed = 2.0;
    readonly maxYawSpeed = 1.0;
    readonly maxPitchSpeed = 3.0;

    /**
     * Maximum speed of the ship in m/s
     * @private
     */
    private readonly maxSpeed = 1400;

    private closestWalkableObject: (Transformable & HasBoundingSphere) | null = null;

    private landingTarget: Transformable | null = null;
    private readonly raycastResult = new PhysicsRaycastResult();

    private state = ShipState.FLYING;

    private nearestOrbitalObject: OrbitalObject | null = null;
    private nearestCelestialBody: CelestialBody | null = null;

    readonly warpTunnel: WarpTunnel;
    readonly hyperSpaceTunnel: HyperSpaceTunnel;

    private readonly scene: Scene;

    private targetLandingPad: LandingPad | null = null;

    private mainThrusters: Thruster[] = [];

    readonly fuelTanks: FuelTank[];

    readonly fuelScoop: FuelScoop | null;
    private isFuelScooping = false;

    readonly enableWarpDriveSound: AudioInstance;
    readonly disableWarpDriveSound: AudioInstance;
    readonly acceleratingWarpDriveSound: AudioInstance;
    readonly deceleratingWarpDriveSound: AudioInstance;
    readonly hyperSpaceSound: AudioInstance;
    readonly thrusterSound: AudioInstance;

    readonly onFuelScoopStart = new Observable<void>();
    readonly onFuelScoopEnd = new Observable<void>();

    readonly onWarpDriveEnabled = new Observable<void>();
    readonly onWarpDriveDisabled = new Observable<boolean>();

    readonly onPlanetaryLandingEngaged = new Observable<void>();
    readonly onLandingObservable = new Observable<void>();
    readonly onLandingCancelled = new Observable<void>();

    readonly onTakeOff = new Observable<void>();

    readonly boundingExtent: Vector3;

    private constructor(serializedSpaceShip: SerializedSpaceship, scene: Scene) {
        this.name = serializedSpaceShip.name;

        this.instanceRoot = Objects.CreateWandererInstance();
        setRotationQuaternion(this.instanceRoot, Quaternion.Identity());

        this.aggregate = new PhysicsAggregate(
            this.instanceRoot,
            PhysicsShapeType.CONTAINER,
            {
                mass: 10,
                restitution: 0.2
            },
            scene
        );
        for (const child of this.instanceRoot.getChildMeshes()) {
            if (child.name.includes("mainThruster")) {
                const mainThruster = new Thruster(child, getForwardDirection(this.instanceRoot).negate(), this.aggregate);
                this.mainThrusters.push(mainThruster);
                continue;
            }
            const childShape = new PhysicsShapeMesh(child as Mesh, scene);
            childShape.filterMembershipMask = CollisionMask.DYNAMIC_OBJECTS;
            childShape.filterCollideMask = CollisionMask.ENVIRONMENT;
            this.aggregate.shape.addChildFromParent(this.instanceRoot, childShape, child);
        }
        this.aggregate.body.disablePreStep = false;
        this.aggregate.body.setAngularDamping(0.9);

        this.aggregate.body.setCollisionCallbackEnabled(true);
        this.collisionObservable = this.aggregate.body.getCollisionObservable();

        this.warpTunnel = new WarpTunnel(this.getTransform(), scene);
        this.hyperSpaceTunnel = new HyperSpaceTunnel(this.getTransform().getDirection(Axis.Z), scene);
        this.hyperSpaceTunnel.setParent(this.getTransform());
        this.hyperSpaceTunnel.setEnabled(false);

        this.enableWarpDriveSound = new AudioInstance(Sounds.ENABLE_WARP_DRIVE_SOUND, AudioMasks.STAR_SYSTEM_VIEW, 1, true, this.getTransform());
        this.disableWarpDriveSound = new AudioInstance(Sounds.DISABLE_WARP_DRIVE_SOUND, AudioMasks.STAR_SYSTEM_VIEW, 1, true, this.getTransform());
        this.acceleratingWarpDriveSound = new AudioInstance(Sounds.ACCELERATING_WARP_DRIVE_SOUND, AudioMasks.STAR_SYSTEM_VIEW, 0, false, this.getTransform());
        this.deceleratingWarpDriveSound = new AudioInstance(Sounds.DECELERATING_WARP_DRIVE_SOUND, AudioMasks.STAR_SYSTEM_VIEW, 0, false, this.getTransform());
        this.hyperSpaceSound = new AudioInstance(Sounds.HYPER_SPACE_SOUND, AudioMasks.HYPER_SPACE, 0, false, this.getTransform());
        this.thrusterSound = new AudioInstance(Sounds.THRUSTER_SOUND, AudioMasks.STAR_SYSTEM_VIEW, 0, false, this.getTransform());

        this.fuelTanks = serializedSpaceShip.fuelTanks.map((tank) => FuelTank.Deserialize(tank));

        this.fuelScoop = serializedSpaceShip.fuelScoop;

        const { min: boundingMin, max: boundingMax } = this.getTransform().getHierarchyBoundingVectors();

        this.boundingExtent = boundingMax.subtract(boundingMin);

        AudioManager.RegisterSound(this.enableWarpDriveSound);
        AudioManager.RegisterSound(this.disableWarpDriveSound);
        AudioManager.RegisterSound(this.acceleratingWarpDriveSound);
        AudioManager.RegisterSound(this.deceleratingWarpDriveSound);
        AudioManager.RegisterSound(this.hyperSpaceSound);
        AudioManager.RegisterSound(this.thrusterSound);

        this.thrusterSound.sound.play();
        this.acceleratingWarpDriveSound.sound.play();
        this.deceleratingWarpDriveSound.sound.play();
        this.hyperSpaceSound.sound.play();

        this.scene = scene;
    }

    public setClosestWalkableObject(object: Transformable & HasBoundingSphere) {
        this.closestWalkableObject = object;
    }

    public getTransform(): TransformNode {
        return this.aggregate.transformNode;
    }

    public setEnabled(enabled: boolean, havokPlugin: HavokPlugin) {
        this.instanceRoot.setEnabled(enabled);
        setEnabledBody(this.aggregate.body, enabled, havokPlugin);
    }

    public setNearestOrbitalObject(orbitalObject: OrbitalObject) {
        this.nearestOrbitalObject = orbitalObject;
    }

    public setNearestCelestialBody(celestialBody: CelestialBody) {
        this.nearestCelestialBody = celestialBody;
    }

    public isWarpDriveEnabled() {
        return this.warpDrive.isEnabled();
    }

    public enableWarpDrive() {
        this.warpDrive.enable();
        this.aggregate.body.setMotionType(PhysicsMotionType.ANIMATED);

        this.aggregate.body.setLinearVelocity(Vector3.Zero());
        this.aggregate.body.setAngularVelocity(Vector3.Zero());

        this.thrusterSound.setTargetVolume(0);

        this.enableWarpDriveSound.sound.play();
        this.onWarpDriveEnabled.notifyObservers();
    }

    public disableWarpDrive() {
        this.warpDrive.disengage();
        this.aggregate.body.setMotionType(PhysicsMotionType.DYNAMIC);

        this.disableWarpDriveSound.sound.play();
        this.onWarpDriveDisabled.notifyObservers(false);
    }

    public emergencyStopWarpDrive() {
        this.warpDrive.emergencyStop();
        this.aggregate.body.setMotionType(PhysicsMotionType.DYNAMIC);

        this.disableWarpDriveSound.sound.play();
        this.onWarpDriveDisabled.notifyObservers(true);
    }

    public toggleWarpDrive() {
        if (!this.warpDrive.isEnabled()) this.enableWarpDrive();
        else this.disableWarpDrive();
    }

    public setMainEngineThrottle(throttle: number) {
        this.mainEngineThrottle = throttle;
    }

    /**
     * Returns a readonly interface to the warp drive of the ship.
     * @returns A readonly interface to the warp drive of the ship.
     */
    public getWarpDrive(): WarpDrive {
        return this.warpDrive;
    }

    /**
     * Returns the speed of the ship in m/s
     * If warp drive is enabled, returns the warp speed
     * If warp drive is disabled, returns the linear velocity of the ship
     * @returns The speed of the ship in m/s
     */
    public getSpeed(): number {
        return this.warpDrive.isEnabled() ? this.warpDrive.getWarpSpeed() : this.aggregate.body.getLinearVelocity().dot(getForwardDirection(this.getTransform()));
    }

    public getThrottle(): number {
        return this.warpDrive.isEnabled() ? this.warpDrive.getThrottle() : this.mainEngineThrottle;
    }

    public increaseMainEngineThrottle(delta: number) {
        this.mainEngineThrottle = Math.max(-1, Math.min(1, this.mainEngineThrottle + delta));
    }

    public getClosestWalkableObject(): (Transformable & HasBoundingSphere) | null {
        return this.closestWalkableObject;
    }

    public engagePlanetaryLanding(landingTarget: Transformable | null) {
        console.log("Landing sequence engaged");
        this.aggregate.body.setMotionType(PhysicsMotionType.ANIMATED);
        this.state = ShipState.LANDING;
        this.landingTarget = landingTarget !== null ? landingTarget : this.closestWalkableObject;
        if (this.landingTarget === null) {
            throw new Error("Landing target is null");
        }

        this.onPlanetaryLandingEngaged.notifyObservers();
    }

    public engageLandingOnPad(landingPad: LandingPad) {
        console.log("Landing on pad", landingPad.getTransform().name);
        this.targetLandingPad = landingPad;
    }

    public getTargetLandingPad(): LandingPad | null {
        return this.targetLandingPad;
    }

    private completeLanding() {
        console.log("Landing sequence complete");
        this.state = ShipState.LANDED;

        this.aggregate.body.setMotionType(PhysicsMotionType.STATIC);
        this.aggregate.shape.filterCollideMask = CollisionMask.DYNAMIC_OBJECTS;
        this.aggregate.shape.filterMembershipMask = CollisionMask.ENVIRONMENT;

        if (this.targetLandingPad !== null) {
            this.getTransform().setParent(this.targetLandingPad.getTransform());
        }

        this.landingTarget = null;

        this.onLandingObservable.notifyObservers();
    }

    public cancelLanding() {
        this.state = ShipState.FLYING;
        this.aggregate.body.setMotionType(PhysicsMotionType.DYNAMIC);
        this.aggregate.shape.filterCollideMask = CollisionMask.DYNAMIC_OBJECTS | CollisionMask.ENVIRONMENT;
        this.aggregate.shape.filterMembershipMask = CollisionMask.DYNAMIC_OBJECTS;

        this.getTransform().setParent(null);
        this.landingTarget = null;
        this.targetLandingPad = null;

        this.onLandingCancelled.notifyObservers();
    }

    public spawnOnPad(landingPad: LandingPad) {
        this.getTransform().setParent(null);
        this.engageLandingOnPad(landingPad);
        this.getTransform().rotationQuaternion = Quaternion.Identity();
        this.getTransform().position.copyFromFloats(0, this.boundingExtent.y / 2, 0);
        this.getTransform().parent = landingPad.getTransform();
        this.completeLanding();
    }

    public isLanded(): boolean {
        return this.state === ShipState.LANDED;
    }

    public isLanding(): boolean {
        return this.state === ShipState.LANDING;
    }

    public isLandedAtFacility(): boolean {
        return this.isLanded() && this.targetLandingPad !== null;
    }

    public takeOff() {
        this.targetLandingPad = null;

        this.state = ShipState.FLYING;
        this.aggregate.body.setMotionType(PhysicsMotionType.DYNAMIC);
        this.aggregate.shape.filterCollideMask = CollisionMask.DYNAMIC_OBJECTS | CollisionMask.ENVIRONMENT;
        this.aggregate.shape.filterMembershipMask = CollisionMask.DYNAMIC_OBJECTS;

        this.getTransform().setParent(null);

        this.aggregate.body.applyImpulse(this.getTransform().up.scale(200), this.getTransform().getAbsolutePosition());

        this.onTakeOff.notifyObservers();
    }

    private land(deltaTime: number) {
        if (this.landingTarget !== null) {
            const gravityDir = this.landingTarget.getTransform().getAbsolutePosition().subtract(this.getTransform().getAbsolutePosition()).normalize();
            const start = this.getTransform().getAbsolutePosition().add(gravityDir.scale(-50e3));
            const end = this.getTransform().getAbsolutePosition().add(gravityDir.scale(50e3));

            (this.scene.getPhysicsEngine() as PhysicsEngineV2).raycastToRef(start, end, this.raycastResult, { collideWith: CollisionMask.ENVIRONMENT });
            if (this.raycastResult.hasHit) {
                const landingSpotNormal = this.raycastResult.hitNormalWorld;

                const landingSpot = this.raycastResult.hitPointWorld.add(this.raycastResult.hitNormalWorld.scale(1.0));

                const distance = landingSpot.subtract(this.getTransform().getAbsolutePosition()).dot(gravityDir);
                translate(this.getTransform(), gravityDir.scale(Math.min(10 * deltaTime * Math.sign(distance), distance)));

                const currentUp = getUpwardDirection(this.getTransform());
                const targetUp = landingSpotNormal;
                let theta = 0.0;
                if (Vector3.Distance(currentUp, targetUp) > 0.01) {
                    const axis = Vector3.Cross(currentUp, targetUp);
                    theta = Math.acos(Vector3.Dot(currentUp, targetUp));
                    rotate(this.getTransform(), axis, Math.min(0.4 * deltaTime, theta));
                }

                if (Math.abs(distance) < this.boundingExtent.y / 2 && Math.abs(theta) < 0.01) {
                    this.completeLanding();
                }
            }
        }
    }

    private landOnPad(landingPad: LandingPad) {
        this.setMainEngineThrottle(0);

        const shipUp = this.getTransform().up;
        const padUp = landingPad.getTransform().up;

        const targetPosition = landingPad.getTransform().getAbsolutePosition();
        targetPosition.addInPlace(padUp.scale(1));

        const currentPosition = this.getTransform().getAbsolutePosition();

        const distance = Vector3.Distance(targetPosition, currentPosition);

        const directionToTarget = targetPosition.subtract(currentPosition).normalize();

        //const currentVelocity = this.aggregate.body.getLinearVelocity();
        //const unwantedVelocity = currentVelocity.subtract(directionToTarget.scale(Vector3.Dot(directionToTarget, currentVelocity)));
        //this.aggregate.body.applyForce(unwantedVelocity.scale(-1), currentPosition);
        //const forceMag = 2000;
        //this.aggregate.body.applyForce(directionToTarget.scale(forceMag), currentPosition);

        this.aggregate.body.setLinearVelocity(directionToTarget.scale(Math.min(Math.max(1, distance), 20)));

        if (distance <= (landingPad.padHeight + this.boundingExtent.y) / 2) {
            this.completeLanding();
            return;
        }

        const upRotationAxis = Vector3.Cross(shipUp, padUp);
        const upRotationAngle = Math.acos(Vector3.Dot(shipUp, padUp));

        this.aggregate.body.applyAngularImpulse(upRotationAxis.scale(upRotationAngle * 0.5));

        const shipForward = getForwardDirection(this.getTransform());
        const padBackward = getForwardDirection(landingPad.getTransform()).negateInPlace();

        const forwardRotationAxis = Vector3.Cross(shipForward, padBackward);
        const forwardRotationAngle = Math.acos(Vector3.Dot(shipForward, padBackward));

        this.aggregate.body.applyAngularImpulse(forwardRotationAxis.scale(forwardRotationAngle * 0.5));

        // dampen rotation that is not along any of the rotation axis
        const angularVelocity = this.aggregate.body.getAngularVelocity();
        const noiseAngularVelocity = angularVelocity.subtract(upRotationAxis.scale(Vector3.Dot(angularVelocity, upRotationAxis)));
        noiseAngularVelocity.subtractInPlace(forwardRotationAxis.scale(Vector3.Dot(noiseAngularVelocity, forwardRotationAxis)));
        this.aggregate.body.applyAngularImpulse(noiseAngularVelocity.scale(-0.1));
    }

    public canEngageWarpDrive() {
        if (this.nearestOrbitalObject !== null) {
            const distanceToObject = Vector3.Distance(this.getTransform().getAbsolutePosition(), this.nearestOrbitalObject.getTransform().getAbsolutePosition());
            if (distanceToObject < this.nearestOrbitalObject.getBoundingRadius() * 1.03) {
                return false;
            }
        }

        if (this.nearestCelestialBody !== null) {
            // if the spaceship goes too close to planetary rings, stop the warp drive to avoid collision with asteroids
            const asteroidField = this.nearestCelestialBody.asteroidField;

            if (asteroidField !== null) {
                const inverseWorld = this.nearestCelestialBody.getTransform().getWorldMatrix().clone().invert();
                const relativePosition = Vector3.TransformCoordinates(this.getTransform().getAbsolutePosition(), inverseWorld);
                const relativeForward = Vector3.TransformNormal(getForwardDirection(this.getTransform()), inverseWorld);
                const distanceAboveRings = relativePosition.y;
                const planarDistance = Math.sqrt(relativePosition.x * relativePosition.x + relativePosition.z * relativePosition.z);

                const nbSecondsPrediction = 0.5;
                const nextRelativePosition = relativePosition.add(relativeForward.scale(this.getSpeed() * nbSecondsPrediction));
                const nextDistanceAboveRings = nextRelativePosition.y;
                const nextPlanarDistance = Math.sqrt(nextRelativePosition.x * nextRelativePosition.x + nextRelativePosition.z * nextRelativePosition.z);

                const ringsMinDistance = asteroidField.minRadius;
                const ringsMaxDistance = asteroidField.maxRadius;

                const isAboveRing = planarDistance > ringsMinDistance && planarDistance < ringsMaxDistance;
                const willBeAboveRing = nextPlanarDistance > ringsMinDistance && nextPlanarDistance < ringsMaxDistance;

                const isInRing = Math.abs(distanceAboveRings) < asteroidField.patchThickness / 2 && isAboveRing;
                const willCrossRing = Math.sign(distanceAboveRings) !== Math.sign(nextDistanceAboveRings) && (willBeAboveRing || isAboveRing);

                if (isInRing || willCrossRing) {
                    return false;
                }
            }
        }

        return true;
    }

    private handleFuelScoop(deltaSeconds: number) {
        if (this.fuelScoop === null) return;
        if (this.nearestCelestialBody === null) return;
        if (![OrbitalObjectType.STAR, OrbitalObjectType.GAS_PLANET].includes(this.nearestCelestialBody.model.type)) return;

        const distanceToBody = Vector3.Distance(this.getTransform().getAbsolutePosition(), this.nearestCelestialBody.getTransform().getAbsolutePosition());
        const currentFuelPercentage = this.getRemainingFuel() / this.getTotalFuelCapacity();
        if (Math.abs(currentFuelPercentage - 1) < 0.01 || distanceToBody > this.nearestCelestialBody.getBoundingRadius() * 1.7) {
            if (this.isFuelScooping) {
                this.isFuelScooping = false;
                this.onFuelScoopEnd.notifyObservers();
            }

            return;
        }

        if (!this.isFuelScooping) {
            this.isFuelScooping = true;
            this.onFuelScoopStart.notifyObservers();
        }

        let fuelAvailability;
        switch (this.nearestCelestialBody.model.type) {
            case OrbitalObjectType.STAR:
                fuelAvailability = 1;
                break;
            case OrbitalObjectType.GAS_PLANET:
                fuelAvailability = 0.3;
                break;
            default:
                fuelAvailability = 0;
        }

        this.refuel(this.fuelScoop.fuelPerSecond * fuelAvailability * deltaSeconds);
    }

    public update(deltaSeconds: number) {
        this.mainEngineTargetSpeed = this.mainEngineThrottle * this.maxSpeed;

        const warpSpeed = getForwardDirection(this.aggregate.transformNode).scale(this.warpDrive.getWarpSpeed());
        this.warpTunnel.update(deltaSeconds);

        const currentForwardSpeed = Vector3.Dot(warpSpeed, this.aggregate.transformNode.getDirection(Axis.Z));

        let closestDistance = Number.POSITIVE_INFINITY;
        let objectHalfThickness = 0;

        this.handleFuelScoop(deltaSeconds);

        if (this.warpDrive.isEnabled()) {
            if (!this.canEngageWarpDrive()) {
                this.emergencyStopWarpDrive();
            }

            if (this.nearestOrbitalObject !== null) {
                const distanceToClosestOrbitalObject = Vector3.Distance(this.getTransform().getAbsolutePosition(), this.nearestOrbitalObject.getTransform().getAbsolutePosition());
                const orbitalObjectRadius = this.nearestOrbitalObject.getBoundingRadius();

                closestDistance = Math.min(closestDistance, distanceToClosestOrbitalObject);
                objectHalfThickness = Math.max(orbitalObjectRadius, objectHalfThickness);
            }

            if (this.nearestCelestialBody !== null) {
                // if the spaceship goes too close to planetary rings, stop the warp drive to avoid collision with asteroids
                const asteroidField = this.nearestCelestialBody.asteroidField;

                if (asteroidField !== null) {
                    const relativePosition = this.getTransform().getAbsolutePosition().subtract(this.nearestCelestialBody.getTransform().getAbsolutePosition());
                    const distanceAboveRings = Math.abs(Vector3.Dot(relativePosition, this.nearestCelestialBody.getRotationAxis()));
                    const planarDistance = relativePosition.subtract(this.nearestCelestialBody.getRotationAxis().scale(distanceAboveRings)).length();

                    const ringsMinDistance = asteroidField.minRadius;
                    const ringsMaxDistance = asteroidField.maxRadius;

                    const isAboveRings = planarDistance > ringsMinDistance && planarDistance < ringsMaxDistance;

                    const distanceToRings = isAboveRings
                        ? Math.abs(distanceAboveRings)
                        : Math.sqrt(Math.min((planarDistance - ringsMinDistance) ** 2, (planarDistance - ringsMaxDistance) ** 2) + distanceAboveRings ** 2);

                    if (distanceToRings < closestDistance) {
                        closestDistance = distanceToRings;
                        objectHalfThickness = asteroidField.patchThickness / 2;
                    }
                }
            }
        }

        this.warpDrive.update(currentForwardSpeed, closestDistance, objectHalfThickness, deltaSeconds);

        // the warp throttle goes from 0.1 to 1 smoothly using an inverse function
        if (this.warpDrive.isEnabled()) this.warpTunnel.setThrottle(1 - 1 / (1.1 * (1 + 1e-7 * this.warpDrive.getWarpSpeed())));
        else this.warpTunnel.setThrottle(0);

        if (this.warpDrive.isDisabled() && this.state !== ShipState.LANDED) {
            const linearVelocity = this.aggregate.body.getLinearVelocity();
            const forwardDirection = getForwardDirection(this.getTransform());
            const forwardSpeed = Vector3.Dot(linearVelocity, forwardDirection);

            const otherSpeed = linearVelocity.subtract(forwardDirection.scale(forwardSpeed));

            if (this.mainEngineThrottle !== 0) this.thrusterSound.setTargetVolume(1);
            else this.thrusterSound.setTargetVolume(0);

            if (forwardSpeed < this.mainEngineTargetSpeed) {
                this.aggregate.body.applyForce(forwardDirection.scale(this.thrusterForce), this.aggregate.body.getObjectCenterWorld());
            } else {
                this.aggregate.body.applyForce(forwardDirection.scale(-0.7 * this.thrusterForce), this.aggregate.body.getObjectCenterWorld());
            }

            this.mainThrusters.forEach((thruster) => {
                thruster.setThrottle(this.mainEngineThrottle);
            });

            // damp other speed
            this.aggregate.body.applyForce(otherSpeed.scale(-10), this.aggregate.body.getObjectCenterWorld());

            if (this.closestWalkableObject !== null) {
                const gravityDir = this.closestWalkableObject.getTransform().getAbsolutePosition().subtract(this.getTransform().getAbsolutePosition()).normalize();
                this.aggregate.body.applyForce(gravityDir.scale(9.8), this.aggregate.body.getObjectCenterWorld());
            }

            this.acceleratingWarpDriveSound.setTargetVolume(0);
            this.deceleratingWarpDriveSound.setTargetVolume(0);

            if (this.targetLandingPad !== null) {
                const shipRelativePosition = this.getTransform().getAbsolutePosition().subtract(this.targetLandingPad.getTransform().getAbsolutePosition());
                const distanceToPad = shipRelativePosition.length();
                const verticalDistance = Vector3.Dot(shipRelativePosition, this.targetLandingPad.getTransform().up);
                if (distanceToPad < 600 && verticalDistance > 0) {
                    if (this.state !== ShipState.LANDING) {
                        //FIXME: move this in ship controls before adding NPC ships
                        createNotification(NotificationOrigin.SPACESHIP, NotificationIntent.INFO, "Automatic landing procedure engaged", 10000);
                    }
                    this.state = ShipState.LANDING;
                    this.landOnPad(this.targetLandingPad);
                }
            }
        }

        if (this.warpDrive.isEnabled()) {
            this.mainThrusters.forEach((thruster) => {
                thruster.setThrottle(0);
            });

            translate(this.getTransform(), warpSpeed.scale(deltaSeconds));

            this.thrusterSound.setTargetVolume(0);

            if (currentForwardSpeed < this.warpDrive.getWarpSpeed()) {
                this.acceleratingWarpDriveSound.setTargetVolume(1);
                this.deceleratingWarpDriveSound.setTargetVolume(0);
            } else {
                this.deceleratingWarpDriveSound.setTargetVolume(1);
                this.acceleratingWarpDriveSound.setTargetVolume(0);
            }
        }

        this.mainThrusters.forEach((thruster) => {
            thruster.update(deltaSeconds);
        });

        if (this.state === ShipState.LANDING) {
            this.land(deltaSeconds);
        }

        const distanceTravelledLY = (this.getSpeed() * deltaSeconds) / Settings.LIGHT_YEAR;
        const fuelToBurn = this.warpDrive.getFuelConsumption(distanceTravelledLY);
        if (fuelToBurn < this.getRemainingFuel()) {
            this.burnFuel(fuelToBurn);
        } else {
            this.emergencyStopWarpDrive();
            this.mainEngineThrottle = 0;
        }
    }

    public getTotalFuelCapacity(): number {
        return this.fuelTanks.reduce((acc, tank) => acc + tank.getMaxFuel(), 0);
    }

    public getRemainingFuel(): number {
        return this.fuelTanks.reduce((acc, tank) => acc + tank.getCurrentFuel(), 0);
    }

    public burnFuel(amount: number): number {
        if (amount > this.getRemainingFuel()) {
            throw new Error("Not enough fuel in the tanks.");
        }

        let fuelLeftToBurn = amount;
        for (const tank of this.fuelTanks) {
            const tankRemainingBefore = tank.getCurrentFuel();
            tank.burnFuel(Math.min(fuelLeftToBurn, tankRemainingBefore));
            const tankRemainingAfter = tank.getCurrentFuel();
            fuelLeftToBurn -= tankRemainingBefore - tankRemainingAfter;
        }

        return amount - fuelLeftToBurn;
    }

    public refuel(amount: number): number {
        let fuelLeftToRefuel = amount;
        for (const tank of this.fuelTanks) {
            const tankRemainingBefore = tank.getCurrentFuel();
            tank.fill(Math.min(fuelLeftToRefuel, tank.getMaxFuel() - tankRemainingBefore));
            const tankRemainingAfter = tank.getCurrentFuel();
            fuelLeftToRefuel -= tankRemainingAfter - tankRemainingBefore;
        }

        return amount - fuelLeftToRefuel;
    }

    public static CreateDefault(scene: Scene): Spaceship {
        return Spaceship.Deserialize(DefaultSerializedSpaceship, scene);
    }

    public static Deserialize(serializedSpaceship: SerializedSpaceship, scene: Scene): Spaceship {
        return new Spaceship(serializedSpaceship, scene);
    }

    public serialize(): SerializedSpaceship {
        return {
            name: this.name,
            type: ShipType.WANDERER,
            fuelTanks: this.fuelTanks.map((tank) => tank.serialize()),
            fuelScoop: this.fuelScoop
        };
    }

    public dispose() {
        AudioManager.DisposeSound(this.enableWarpDriveSound);
        AudioManager.DisposeSound(this.disableWarpDriveSound);
        AudioManager.DisposeSound(this.acceleratingWarpDriveSound);
        AudioManager.DisposeSound(this.deceleratingWarpDriveSound);
        AudioManager.DisposeSound(this.thrusterSound);

        this.mainThrusters.forEach((thruster) => thruster.dispose());
        this.mainThrusters.length = 0;

        this.warpTunnel.dispose();
        this.hyperSpaceTunnel.dispose();
        this.aggregate.dispose();
        this.instanceRoot.dispose();

        this.onWarpDriveEnabled.clear();
        this.onWarpDriveDisabled.clear();

        this.onFuelScoopStart.clear();
        this.onFuelScoopEnd.clear();

        this.onPlanetaryLandingEngaged.clear();
        this.onLandingObservable.clear();
    }
}
