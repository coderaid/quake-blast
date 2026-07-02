/** Central tuning knobs. Tweak gameplay feel here without hunting through systems. */
export const CONFIG = {
  arena: {
    halfSize: 40, // arena spans [-halfSize, +halfSize] on X and Z
    wallHeight: 8,
  },
  player: {
    eyeHeight: 1.7,
    moveSpeed: 28, // acceleration units/s^2 applied to velocity
    damping: 9, // higher = snappier stops
    maxHealth: 100,
    radius: 0.6, // collision radius against walls
    jumpSpeed: 12, // upward velocity of a jump (clears one brick with margin)
    gravity: 26, // downward acceleration
  },
  weapon: {
    damage: 34,
    range: 100,
    cooldown: 0.12, // seconds between shots
  },
  build: {
    duration: 60, // seconds of build phase before the assault
    budget: 24, // number of bricks the player may place (stackable)
    maxStack: 8, // max bricks in one grid column
  },
  building: {
    size: 3, // footprint width/depth (grid cell)
    height: 2, // short enough that a jump clears one brick
    maxHealth: 150,
  },
  monster: {
    count: 4, // size of the assault wave
    speed: 3,
    radius: 0.8,
    maxHealth: 100,
    damagePerSecond: 25, // damage to whatever it is attacking (base or player)
    spawnInterval: 0.25, // seconds between each monster entering the arena
  },
  // Flying "red-eyed eagle" attackers — their own pool on top of the rabbit wave.
  eagle: {
    count: 2, // eagles added to the assault, counted alongside monsters
    speed: 6, // faster than the ground horde
    radius: 0.9,
    maxHealth: 70,
    damagePerSecond: 18, // dealt while diving on a base/player
    spawnInterval: 0.6, // seconds between each eagle entering the arena
    cruiseHeight: 7, // altitude while soaring toward a target
    diveHeight: 2, // altitude when in striking range of a target
    climbRate: 2.5, // how fast altitude eases toward its goal (per second)
    flapRate: 9, // wing-beat speed during the flap part of the cycle (rad/s)
    flapDuration: 0.9, // seconds spent flapping (gaining altitude) each cycle
    glideDuration: 1.4, // seconds spent gliding (wings held) each cycle
    perchInterval: 7, // min seconds soaring before it may perch again
    perchChance: 0.4, // per-second probability of choosing to perch once eligible
    perchDuration: 4, // seconds spent sitting on a tree
  },
} as const;
