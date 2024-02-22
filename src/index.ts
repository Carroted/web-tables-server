import server, { geckos } from "@geckos.io/server";
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();
console.log('RAPIER initialized');

class Room {
    world: RAPIER.World;
    currentID = 0;
    stepCount = 0;

    changedContents: { [id: string]: ShapeContentData } = {};
    removedContents: string[] = [];
    colliders: RAPIER.Collider[] = [];
    idToCollider: { [id: string]: RAPIER.Collider } = {};

    cursors: { [id: string]: { x: number, y: number, z: number, color: number } } = {};
    heldObjects: { [playerID: string]: RAPIER.RigidBody[] } = {};

    constructor() {
        let gravity = { x: 0.0, y: -9.81, z: 0.0 };
        let world = new RAPIER.World(gravity);
        this.world = world;

        const table = this.addCuboid({
            width: 10,
            height: 0.1,
            depth: 10,
            position: { x: 0, y: -0.05, z: 0 },
            rotation: RAPIER.RotationOps.identity(),
            color: 0x888888,
            alpha: 1,
            isStatic: true,
            friction: 0.5,
            restitution: 0.5,
            density: 1,
            name: "Table",
            sound: null,
            model: null,
            modelScale: null,
            modelOffset: null,
        });

        const ball = this.addBall({
            radius: 0.1,
            position: { x: 2, y: 1, z: 0 },
            rotation: RAPIER.RotationOps.identity(),
            color: 0x00ff00,
            alpha: 1,
            isStatic: false,
            friction: 0.5,
            restitution: 0.5,
            density: 1,
            name: "Ball",
            sound: null,
            model: null,
            modelScale: null,
            modelOffset: null,
        });

        const box = this.addCuboid({
            width: 0.2,
            height: 0.2,
            depth: 0.2,
            position: { x: 0.1, y: 2, z: 0 },
            rotation: RAPIER.RotationOps.identity(),
            color: 0xff0000,
            alpha: 1,
            isStatic: false,
            friction: 0.5,
            restitution: 0.5,
            density: 1,
            name: "Box",
            sound: null,
            model: null,
            modelScale: null,
            modelOffset: null,
        });

        const d6 = this.addCuboid({
            width: 0.18,
            height: 0.18,
            depth: 0.18,
            position: { x: 0.1, y: 2, z: 2 },
            rotation: RAPIER.RotationOps.identity(),
            color: 0xffffff,
            alpha: 1,
            isStatic: false,
            friction: 0.5,
            restitution: 0.5,
            density: 1,
            name: "d6",
            sound: null,
            model: null,
            modelScale: null,
            modelOffset: null,
        });

        this.addMeeple(0xff0000, { x: -3, y: 0.1, z: 3 });
        this.addMeeple(0x00ff00, { x: 3, y: 0.1, z: 3 });
        this.addMeeple(0x0000ff, { x: 1, y: 0.1, z: 3 });
    }

    addMeeple(color: number, position: { x: number, y: number, z: number }) {
        const meeple = this.addCuboid({
            width: 0.25,
            height: 0.4,
            depth: 0.25,
            position,
            rotation: RAPIER.RotationOps.identity(),
            color,
            alpha: 1,
            isStatic: false,
            friction: 0.5,
            restitution: 0,
            density: 1,
            name: "Meeple",
            sound: null,
            model: '/meeple.gltf',
            modelScale: 0.1,
            modelOffset: { x: 0, y: -1.99, z: 0 },
        });
    }

    step(): PhysicsStepInfo {
        let before = new Date().getTime();

        this.world.step();

        for (let collider of this.colliders) {
            let body = collider.parent();
            if (!body) continue;
            let translation = body.translation();
            if (translation.y < -10) {
                body.setTranslation(
                    new RAPIER.Vector3(
                        Math.min(5, Math.max(-5, translation.x)),
                        1,
                        Math.min(5, Math.max(-5, translation.z)),
                    ),
                    true
                );
                body.setGravityScale(0, true);
                body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
                body.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
            }
        }

        // apply force to get to the point
        for (let playerID in this.heldObjects) {
            for (let rb of this.heldObjects[playerID]) {
                let mousePoint = this.cursors[playerID];
                if (!mousePoint) continue;
                let movement = new RAPIER.Vector3((mousePoint.x - rb.translation().x), 0, (mousePoint.z - rb.translation().z));

                const force = 0.05;
                const maxForce = 0.1;
                movement.x *= force;
                movement.y *= force;
                movement.z *= force;
                if (movement.x > maxForce) movement.x = maxForce;
                if (movement.y > maxForce) movement.y = maxForce;
                if (movement.z > maxForce) movement.z = maxForce;

                rb.applyImpulse(movement, true);
            }
        }

        let info = this.getStepInfo(before);

        //io.emit('physicsStep', info);

        this.stepCount++;

        return info;

        //setTimeout(step, 20); // 50fps
    }

    generateId() {
        return `object-${this.currentID++}`;
    }


    addCuboid(cuboid: BaseShapeData & {
        width: number,
        height: number,
        depth: number,
    }) {
        let bodyDesc = cuboid.isStatic ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
        bodyDesc = bodyDesc.setTranslation(
            cuboid.position.x,
            cuboid.position.y,
            cuboid.position.z
        );

        let data: ObjectData = {
            color: cuboid.color,
            alpha: cuboid.alpha,
            name: cuboid.name,
            sound: cuboid.sound,
            id: this.generateId(),
            description: undefined,
            model: cuboid.model,
            modelScale: cuboid.modelScale,
            modelOffset: cuboid.modelOffset,
        };

        bodyDesc.setUserData(data);

        let body = this.world.createRigidBody(bodyDesc);
        // no collide
        let colliderDesc = RAPIER.ColliderDesc.cuboid(cuboid.width / 2, cuboid.height / 2, cuboid.depth / 2).setRestitution(cuboid.restitution).setFriction(cuboid.friction).setDensity(cuboid.density)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
        let coll = this.world.createCollider(colliderDesc!, body);

        this.colliders.push(coll);
        this.idToCollider[data.id] = coll;
        let content = getShapeContent(coll);
        if (content) {
            this.changedContents[data.id] = content;
        }

        return coll;
    }

    addBall(ball: BaseShapeData & {
        radius: number,
    }) {
        let bodyDesc = ball.isStatic ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
        bodyDesc = bodyDesc.setTranslation(
            ball.position.x,
            ball.position.y,
            ball.position.z
        );

        let data: ObjectData = {
            color: ball.color,
            alpha: ball.alpha,
            name: ball.name,
            sound: ball.sound,
            id: this.generateId(),
            description: undefined,
            model: ball.model,
            modelScale: ball.modelScale,
            modelOffset: ball.modelOffset,
        };

        bodyDesc.setUserData(data);

        let body = this.world.createRigidBody(bodyDesc);
        // no collide
        let colliderDesc = RAPIER.ColliderDesc.ball(ball.radius).setRestitution(ball.restitution).setFriction(ball.friction).setDensity(ball.density)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
        let coll = this.world.createCollider(colliderDesc!, body);

        this.colliders.push(coll);
        this.idToCollider[data.id] = coll;
        let content = getShapeContent(coll);
        if (content) {
            this.changedContents[data.id] = content;
            console.log('added ball', data.id);
        }

        return coll;
    }


    getStepInfo(before: number): PhysicsStepInfo {
        let changed = this.changedContents;
        this.changedContents = {};
        let removed = this.removedContents;
        this.removedContents = [];

        let transforms: { [id: string]: ShapeTransformData } = this.getShapeTransforms();

        for (let cursor in this.cursors) {
            transforms['cursor-' + cursor] = {
                x: this.cursors[cursor].x,
                y: this.cursors[cursor].y,
                z: this.cursors[cursor].z,
                rotation: RAPIER.RotationOps.identity(),
            };
        }

        return {
            delta: {
                shapeContent: changed,
                shapeTransforms: transforms,
                removedContents: removed,
            },
            ms: new Date().getTime() - before,
            sounds: [],
        };
    }

    getFullStepInfo(): PhysicsStepInfo {
        // loop over every collider and get its shape content
        let changed: { [id: string]: ShapeContentData } = {};
        this.colliders.forEach((collider) => {
            let content = getShapeContent(collider);
            if (content) {
                changed[content.id] = content;
            }
        });

        let transforms: { [id: string]: ShapeTransformData } = this.getShapeTransforms();

        for (let cursor in this.cursors) {
            transforms['cursor-' + cursor] = {
                x: this.cursors[cursor].x,
                y: this.cursors[cursor].y,
                z: this.cursors[cursor].z,
                rotation: RAPIER.RotationOps.identity(),
            };

            let ball: Ball = {
                id: 'cursor-' + cursor,
                name: 'Player Cursor',
                description: undefined,
                type: "ball",
                color: this.cursors[cursor].color,
                alpha: 1,
                radius: 0.04,
                model: null,
                modelScale: null,
                modelOffset: null,
            };

            changed['cursor-' + cursor] = ball;
        }


        return {
            delta: {
                shapeContent: changed,
                shapeTransforms: transforms,
                removedContents: [],
            },
            ms: 0,
            sounds: [],
        };
    }

    getShapeTransforms(): { [id: string]: ShapeTransformData } {
        let transforms: { [id: string]: ShapeTransformData } = {};
        this.colliders.forEach((collider) => {
            let parent = collider.parent();
            if (!parent) return;
            let translation = parent.translation();
            let rot = parent.rotation();
            let data = parent.userData as ObjectData;
            transforms[data.id] = {
                x: translation.x,
                y: translation.y,
                z: translation.z,
                rotation: rot,
            };
        });
        return transforms;
    }
}



// server.js
const io = geckos({
    multiplex: true, // default
    cors: { allowAuthorization: true, origin: '*' },
});

// --prod arg
let prod = process.argv.includes('--prod');
if (prod) {
    console.log('Running in production mode');
    var fs = require('fs');
    var http = require('http');
    var https = require('https');
    var privateKey = fs.readFileSync('/etc/letsencrypt/live/table.carroted.org/privkey.pem', 'utf8');
    var certificate = fs.readFileSync('/etc/letsencrypt/live/table.carroted.org/fullchain.pem', 'utf8');

    var credentials = { key: privateKey, cert: certificate };

    var httpsServer = https.createServer(credentials);
    io.addServer(httpsServer);
    httpsServer.listen(9208);
} else {
    console.log('Running in development mode');
    io.listen(); // default port is 9208
}



interface ShapeContentData {
    id: string;
    name: string | undefined;
    description: string | undefined;
    type: "cuboid" | "ball" | "polygon" | "line";
    color: number;
    /** 0-1 alpha */
    alpha: number;
    model: string | null;
    modelScale: number | null;
    modelOffset: { x: number, y: number, z: number } | null;
}

interface CollisionSound {
    sound: string;
    volume: number;
}

interface Cuboid extends ShapeContentData {
    type: "cuboid";
    width: number;
    height: number;
    depth: number;
}

interface Ball extends ShapeContentData {
    type: "ball";
    radius: number;
}

/** Translation and rotation to apply to a shape. Scale is not included in this (and is instead in `ShapeContentData`) since it rarely changes, unlike position and rotation, which usually change every frame. */
interface ShapeTransformData {
    x: number;
    y: number;
    z: number;
    rotation: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
}

interface PhysicsStepInfo {
    delta: {
        /** Shape content that has changed since last step. */
        shapeContent: { [id: string]: ShapeContentData };

        /** New positioning and rotation of shape contents. */
        shapeTransforms: { [id: string]: ShapeTransformData };

        /** IDs of shape contents that are no more. */
        removedContents: string[];
    };

    ms: number;

    sounds: CollisionSound[];
}


/** User data on Rapier objects */
interface ObjectData {
    name: string | undefined;
    description: string | undefined;
    /** Path to a sound file for collisions. Relative to /assets/sounds/ */
    sound: string | null;
    /** Color number like 0xffffff */
    color: number;
    /** 0-1 alpha */
    alpha: number;
    id: string;
    model: string | null;
    modelScale: number | null;
    modelOffset: { x: number, y: number, z: number } | null;
}


interface BaseShapeData {
    name: string | undefined;
    /** Path to a sound file for collisions. Relative to /assets/sounds/ */
    sound: string | null;
    /** Color number like 0xffffff */
    color: number;
    /** 0-1 alpha */
    alpha: number;
    position: { x: number, y: number, z: number },
    rotation: { x: number, y: number, z: number, w: number },
    isStatic: boolean,
    friction: number,
    restitution: number,
    density: number,
    model: string | null,
    modelScale: number | null,
    modelOffset: { x: number, y: number, z: number } | null;
}

function getShapeContent(collider: RAPIER.Collider): ShapeContentData | null {
    let shape = collider.shape;
    let parent = collider.parent();
    if (!parent) return null;
    let bodyData = parent.userData as ObjectData;
    let color = bodyData.color;

    let baseShape: ShapeContentData = {
        id: bodyData.id,
        type: "cuboid",
        color: color,
        alpha: bodyData.alpha,
        name: bodyData.name,
        description: bodyData.description,
        model: bodyData.model,
        modelScale: bodyData.modelScale,
        modelOffset: bodyData.modelOffset,
    };

    switch (shape.type) {
        case RAPIER.ShapeType.Cuboid:
            let cuboid = shape as RAPIER.Cuboid;
            let halfExtents = cuboid.halfExtents;
            let width = halfExtents.x * 2;
            let height = halfExtents.y * 2;
            let depth = halfExtents.z * 2;
            let rect: Cuboid = {
                ...baseShape,
                type: "cuboid",
                width: width,
                height: height,
                depth: depth,
            };
            return rect;
        case RAPIER.ShapeType.Ball:
            let ball = shape as RAPIER.Ball;
            let radius = ball.radius;
            return {
                ...baseShape,
                type: "ball",
                radius: radius,
            } as Ball;
        default:
            console.log("Unknown shape type", shape.type);
            break;
    }
    return null;
}

const rooms: { [id: string]: Room } = {};

// it can be Dangerous if players start spamming rooms, each one is an entire physics world
const maxRooms = 2;

function stepWorlds() {
    for (let roomID in rooms) {
        let room = rooms[roomID];
        let info = room.step();
        io.room(roomID).emit('physicsStep', info);
    }

    setTimeout(stepWorlds, 20);
}

rooms['zone'] = new Room();

stepWorlds();

let channelCount = 0;
let colors = [0xffff00, 0x00ffff, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];

io.onConnection(channel => {
    let id = channelCount++;
    let color = colors[id % colors.length];

    channel.emit('me', {
        id: id,
        color: color,
    }, {
        reliable: true,
    });

    channel.on('joinRoom', data => {
        let roomID = data as string;
        let room = rooms[roomID];
        channel.leave();
        if (!room) {
            channel.emit('error', 'Room not found');
            channel.join('lobby');
            console.log('Player', id, 'tried to join non-existent room', roomID);
            return;
        }
        channel.join(roomID);
        console.log('Player', id, 'joined room', roomID);

        let ball: Ball = {
            id: 'cursor-' + id,
            name: 'Player Cursor',
            description: undefined,
            type: "ball",
            color: color,
            alpha: 1,
            radius: 0.04,
            model: null,
            modelScale: null,
            modelOffset: null,
        };

        room.changedContents['cursor-' + id] = ball;

        // give them the current state, we get absolutely all contents and transforms
        channel.emit('physicsStep', room.getFullStepInfo());
    });

    channel.on('createRoom', data => {
        let roomID = data as string;
        if (rooms[roomID]) {
            channel.emit('error', 'Room already exists');
            return;
        }
        if (Object.keys(rooms).length >= maxRooms) {
            channel.emit('error', 'Too many rooms already, sorry lololol');
            return;
        }
        rooms[roomID] = new Room();
        channel.join(roomID);
        console.log('Player', id, 'created room', roomID);
    });

    channel.onDisconnect(() => {
        console.log(`${channel.id} got disconnected`);
        // TODO: remove cursors
    });

    channel.on('chat message', data => {
        console.log(`got "${data}" from "chat message"`)
        // emit the "chat message" data to all channels in the same room
        io.room(channel.roomId).emit('chat message', data)
    });

    channel.on('mouseMove', data => {
        if (!channel.roomId) return;
        let room = rooms[channel.roomId];
        if (!room) return;

        let mouseData = data as {
            x: number,
            y: number,
            z: number,
            coll?: number, // hovering over this collider
        };
        room.cursors[id] = {
            x: mouseData.x,
            y: mouseData.y,
            z: mouseData.z,
            color: 0xffffff,
        };
        if (mouseData.coll !== undefined) {
            let coll = room.idToCollider[mouseData.coll];
            if (!coll) {
                console.log('no collider for', mouseData.coll);
                return;
            }
            let parent = coll.parent();
            if (parent) {
                //parent.applyImpulse({ x: 0, y: 0.001, z: 0 }, true);
            } else {
                console.log('no parent');
            }
        }
        io.room(channel.roomId).emit('cursors', room.cursors);
    });

    // on mousedown
    channel.on('mouseDown', data => {
        if (!channel.roomId) return;
        let room = rooms[channel.roomId];
        if (!room) return;

        let mouseData = data as {
            x: number,
            y: number,
            z: number,
            coll?: number, // hovering over this collider
        };
        /*let cuboid = addCuboid({
            width: 0.2,
            height: 0.2,
            depth: 0.2,
            position: { x: mouseData.x, y: mouseData.y + 0.1, z: mouseData.z },
            rotation: RAPIER.RotationOps.identity(),
            color: 0xff0000,
            alpha: 1,xact
            isStatic: false,
            friction: 0.5,
            restitution: 0.5,
            density: 1,
            name: "Box",
            sound: null,
        });*/
        if (room.heldObjects[id] === undefined) {
            room.heldObjects[id] = [];
        }

        if (mouseData.coll !== undefined) {
            let coll = room.idToCollider[mouseData.coll];
            if (!coll) {
                console.log('no collider for', mouseData.coll);
                return;
            }
            let parent = coll.parent();
            if (parent) {
                room.heldObjects[id].push(parent);
                parent.setLinearDamping(100);
                parent.setAngularDamping(100);
                parent.setGravityScale(0, true);
                let data = parent.userData as ObjectData;
                channel.emit('grabbing', [data.id]);
            } else {
                console.log('no parent');
            }
        }
    });

    // mouse up = do nothing except clear held objects
    channel.on('mouseUp', data => {
        if (!channel.roomId) return;
        let room = rooms[channel.roomId];
        if (!room) return;

        // reset all held objects
        if (room.heldObjects[id] === undefined) {
            room.heldObjects[id] = [];
        }
        for (let rb of room.heldObjects[id]) {
            rb.setLinearDamping(0);
            rb.setAngularDamping(0);
            rb.setGravityScale(1, true);
        }
        room.heldObjects[id] = [];
    });

    channel.on('spawnCuboid', data => {
        if (!channel.roomId) return;
        let room = rooms[channel.roomId];
        if (!room) return;

        let mouseData = data as {
            x: number,
            y: number,
            z: number,
        };

        room.addCuboid({
            width: 0.2,
            height: 0.2,
            depth: 0.2,
            position: { x: mouseData.x, y: mouseData.y + 0.1, z: mouseData.z },
            rotation: RAPIER.RotationOps.identity(),
            color: 0xff0000,
            alpha: 1,
            isStatic: false,
            friction: 0.5,
            restitution: 0.5,
            density: 1,
            name: "Box",
            sound: null,
            model: null,
            modelScale: null,
            modelOffset: null,
        });
    });

    channel.on('roll', data => {
        if (!channel.roomId) return;
        let room = rooms[channel.roomId];
        if (!room) return;

        let collData = data as {
            coll: string,
        };
        let coll = room.idToCollider[collData.coll];
        if (!coll) {
            console.log('no collider for', collData.coll);
            return;
        }
        let parent = coll.parent();
        if (parent) {
            let data = parent.userData as ObjectData;
            let force = new RAPIER.Vector3(0, 0.02, 0);
            parent.applyImpulse(force, true);
            if ((data.name || '').startsWith('d')) {
                let torque = new RAPIER.Vector3(0.001, 0.001, 0.001);
                parent.applyTorqueImpulse(torque, true);

                // set name to "d6 (<number>)"
                let val = Math.floor(Math.random() * 6) + 1;
                data.name = `d6 (${val})`;
                let content = getShapeContent(coll);
                if (content) {
                    content.name = data.name;
                    room.changedContents[data.id] = content;
                }
            }
            console.log('rolling', collData.coll);
        } else {
            console.log('no parent');
        }
    });

    channel.on('scroll', data => {
        // if they are holding objects, spin them all with rb.applyTorqueImpulse(new RAPIER.Vector3(0,delta, 0), true);
        let delta = data as number;

        if (!channel.roomId) return;

        let room = rooms[channel.roomId];

        if (!room) return;

        if (room.heldObjects[id] === undefined) {
            room.heldObjects[id] = [];
        }

        for (let rb of room.heldObjects[id]) {
            let data = rb.userData as ObjectData;
            rb.applyTorqueImpulse(new RAPIER.Vector3(0, delta * 2, 0), true);
        }
    });
});

console.log('hi guys :3');