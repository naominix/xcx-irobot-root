import RootSimulator from '../../src/vm/extensions/block/root-simulator.js';

describe('physical Root outline collisions', () => {
    const wall = {x: 0, y: 200, width: 300, height: 14};
    test('touches the near face with its 80 mm front vertex', () => {
        const sim = new RootSimulator();
        sim.obstacles = [wall];
        expect(sim._collisionAt({x: 0, y: 112.9, heading: 90})).toBeNull();
        expect(sim._collisionAt({x: 0, y: 113, heading: 90}))
            .toMatchObject({left: true, right: true, y: 193});
    });
    test.each([0.25, 0.5, 1, 2])('thin-wall stopping is independent of zoom %s', zoom => {
        const sim = new RootSimulator();
        sim.viewZoom = zoom;
        sim.obstacles = [{...wall, height: 0.2}];
        expect(sim._setPose({x: 0, y: 1000, heading: 90})).toBe(false);
        expect(sim.pose.y).toBeGreaterThan(118.9);
        expect(sim.pose.y).toBeLessThan(119.9);
    });
    test('uses hexagon side rather than an enclosing circle', () => {
        const sim = new RootSimulator();
        sim.obstacles = [{x: 76, y: 0, width: 2, height: 10}];
        expect(sim._collisionAt({x: 0, y: 0, heading: 90})).toBeNull();
        sim.obstacles[0].x = 69;
        expect(sim._collisionAt({x: 0, y: 0, heading: 90})).toMatchObject({left: false, right: true});
        sim.obstacles[0].x = -69;
        expect(sim._collisionAt({x: 0, y: 0, heading: 90})).toMatchObject({left: true, right: false});
    });
    test('detects a corner swept through during rotation', () => {
        const sim = new RootSimulator();
        sim.obstacles = [{x: 78, y: 0, width: 1, height: 1}];
        expect(sim._collisionAt(sim.pose)).toBeNull();
        expect(sim._setPose({x: 0, y: 0, heading: 30})).toBe(false);
        expect(sim.pose.heading).toBeGreaterThan(60);
        expect(sim.pose.heading).toBeLessThan(90);
    });
});
