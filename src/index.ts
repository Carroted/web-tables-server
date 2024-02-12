import server, { geckos } from "@geckos.io/server";
import RAPIER from '@dimforge/rapier3d-compat';

var fs = require('fs');
var http = require('http');
var https = require('https');
var privateKey  = fs.readFileSync('/etc/letsencrypt/live/table.carroted.org/privkey.pem', 'utf8');
var certificate = fs.readFileSync('/etc/letsencrypt/live/table.carroted.org/fullchain.pem', 'utf8');

var credentials = {key: privateKey, cert: certificate};

await RAPIER.init();
console.log('RAPIER initialized');

let gravity = { x: 0.0, y: -9.81, z: 0.0 };
let world = new RAPIER.World(gravity);

// server.js
const io = geckos({
    multiplex: true, // default
    cors: { allowAuthorization: true, origin: '*' },
});


io.listen(); // default port is 9208

var httpsServer = https.createServer(credentials);
io.addServer(httpsServer);
httpsServer.listen(9208);

interface ShapeContentData {
    id: string;
    name: string | undefined;
    description: string | undefined;
    type: "cuboid" | "ball" | "polygon" | "line";
    color: number;
    /** 0-1 alpha */
    alpha: number;
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

let changedContents: { [id: string]: ShapeContentData } = {};
let removedContents: string[] = [];
let colliders: RAPIER.Collider[] = [];
let idToCollider: { [id: string]: RAPIER.Collider } = {};

let cursors: { [id: string]: { x: number, y: number, z: number, color: number } } = {};
let heldObjects: { [playerID: string]: RAPIER.RigidBody[] } = {};

function getStepInfo(before: number): PhysicsStepInfo {
    let changed = changedContents;
    changedContents = {};
    let removed = removedContents;
    removedContents = [];

    let transforms: { [id: string]: ShapeTransformData } = getShapeTransforms();

    for (let cursor in cursors) {
        transforms['cursor-' + cursor] = {
            x: cursors[cursor].x,
            y: cursors[cursor].y,
            z: cursors[cursor].z,
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

function getFullStepInfo(): PhysicsStepInfo {
    // loop over every collider and get its shape content
    let changed: { [id: string]: ShapeContentData } = {};
    colliders.forEach((collider) => {
        let content = getShapeContent(collider);
        if (content) {
            changed[content.id] = content;
        }
    });

    let transforms: { [id: string]: ShapeTransformData } = getShapeTransforms();

    for (let cursor in cursors) {
        transforms['cursor-' + cursor] = {
            x: cursors[cursor].x,
            y: cursors[cursor].y,
            z: cursors[cursor].z,
            rotation: RAPIER.RotationOps.identity(),
        };

        let ball: Ball = {
            id: 'cursor-' + cursor,
            name: 'Player Cursor',
            description: undefined,
            type: "ball",
            color: cursors[cursor].color,
            alpha: 1,
            radius: 0.04,
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
}

function getShapeTransforms(): { [id: string]: ShapeTransformData } {
    let transforms: { [id: string]: ShapeTransformData } = {};
    colliders.forEach((collider) => {
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

let currentID = 0;
function generateId() {
    return `object-${currentID++}`;
}

function addCuboid(cuboid: BaseShapeData & {
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
        id: generateId(),
        description: undefined,
    };

    bodyDesc.setUserData(data);

    let body = world.createRigidBody(bodyDesc);
    // no collide
    let colliderDesc = RAPIER.ColliderDesc.cuboid(cuboid.width / 2, cuboid.height / 2, cuboid.depth / 2).setRestitution(cuboid.restitution).setFriction(cuboid.friction).setDensity(cuboid.density)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    let coll = world.createCollider(colliderDesc!, body);

    colliders.push(coll);
    idToCollider[data.id] = coll;
    let content = getShapeContent(coll);
    if (content) {
        changedContents[data.id] = content;
    }

    return coll;
}

function addBall(ball: BaseShapeData & {
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
        id: generateId(),
        description: undefined,
    };

    bodyDesc.setUserData(data);

    let body = world.createRigidBody(bodyDesc);
    // no collide
    let colliderDesc = RAPIER.ColliderDesc.ball(ball.radius).setRestitution(ball.restitution).setFriction(ball.friction).setDensity(ball.density)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    let coll = world.createCollider(colliderDesc!, body);

    colliders.push(coll);
    idToCollider[data.id] = coll;
    let content = getShapeContent(coll);
    if (content) {
        changedContents[data.id] = content;
        console.log('added ball', data.id);
    }

    return coll;
}

const table = addCuboid({
    width: 10,
    height: 0.1,
    depth: 10,
    position: { x: 0, y: -0.05, z: 0 },
    rotation: RAPIER.RotationOps.identity(),
    color: 0xcccccc,
    alpha: 1,
    isStatic: true,
    friction: 0.5,
    restitution: 0.5,
    density: 1,
    name: "Table",
    sound: null,
});

const ball = addBall({
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
});

const box = addCuboid({
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
});

const d6 = addCuboid({
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
});

let stepCount = 0;

function step() {
    let before = new Date().getTime();

    world.step();

    for (let collider of colliders) {
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
    for (let playerID in heldObjects) {
        for (let rb of heldObjects[playerID]) {
            let mousePoint = cursors[playerID];
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

    let info = getStepInfo(before);

    io.emit('physicsStep', info);

    stepCount++;
    if (stepCount % 100 === 0) {
        console.log(`Physics step ${stepCount}`);
    }

    setTimeout(step, 20); // 50fps
}

step();

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

    let ball: Ball = {
        id: 'cursor-' + id,
        name: 'Player Cursor',
        description: undefined,
        type: "ball",
        color: color,
        alpha: 1,
        radius: 0.04,
    };

    changedContents['cursor-' + id] = ball;

    channel.onDisconnect(() => {
        console.log(`${channel.id} got disconnected`)
    });

    // give them the current state, we get absolutely all contents and transforms
    channel.emit('physicsStep', getFullStepInfo());

    channel.on('chat message', data => {
        console.log(`got "${data}" from "chat message"`)
        // emit the "chat message" data to all channels in the same room
        io.room(channel.roomId).emit('chat message', data)
    });

    channel.on('mouseMove', data => {
        let mouseData = data as {
            x: number,
            y: number,
            z: number,
            coll?: number, // hovering over this collider
        };
        cursors[id] = {
            x: mouseData.x,
            y: mouseData.y,
            z: mouseData.z,
            color: 0xffffff,
        };
        if (mouseData.coll !== undefined) {
            let coll = idToCollider[mouseData.coll];
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
        io.room(channel.roomId).emit('cursors', cursors);
    });

    // on mousedown
    channel.on('mouseDown', data => {
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
            alpha: 1,
            isStatic: false,
            friction: 0.5,
            restitution: 0.5,
            density: 1,
            name: "Box",
            sound: null,
        });*/
        if (heldObjects[id] === undefined) {
            heldObjects[id] = [];
        }

        if (mouseData.coll !== undefined) {
            let coll = idToCollider[mouseData.coll];
            if (!coll) {
                console.log('no collider for', mouseData.coll);
                return;
            }
            let parent = coll.parent();
            if (parent) {
                heldObjects[id].push(parent);
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
        // reset all held objects
        if (heldObjects[id] === undefined) {
            heldObjects[id] = [];
        }
        for (let rb of heldObjects[id]) {
            rb.setLinearDamping(0);
            rb.setAngularDamping(0);
            rb.setGravityScale(1, true);
        }
        heldObjects[id] = [];
    });

    channel.on('spawnCuboid', data => {
        let mouseData = data as {
            x: number,
            y: number,
            z: number,
        };

        addCuboid({
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
        });
    });

    channel.on('roll', data => {
        let collData = data as {
            coll: string,
        };
        let coll = idToCollider[collData.coll];
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
                    changedContents[data.id] = content;
                }
            }
            console.log('rolling', collData.coll);
        } else {
            console.log('no parent');
        }
    });
});

console.log('hi guys :3');