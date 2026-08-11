import RootSimulator from './root-simulator';

const DEG = Math.PI / 180;
const SCALE = 1.8;
const ROBOT_RADIUS = 24;
const TOUCH_RADIUS = 44;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const headingRadians = heading => heading * DEG;
const normalizeHeading = heading => ((heading % 360) + 360) % 360;

/**
 * A shared simulator world for the multi-root build. Each RootSimulator child
 * owns one robot's pose, sensors, LED and motion timers; this class owns the
 * single canvas and shared obstacles.
 */
class RootSimulatorWorld {
    constructor (onEvent, controls = {}) {
        this.onEvent = onEvent;
        this.controls = controls;
        this.robots = new Map();
        this.obstacles = [];
        this.activeId = 1;
        this.host = new RootSimulator(null, controls);
        this.host._draw = () => this._draw();
        this.host._pointerDown = event => this._pointerDown(event);
        this.host._pointerMove = event => this._pointerMove(event);
        this.host._pointerUp = event => this._pointerUp(event);
        this.host.obstacles = this.obstacles;
        this.host.reset = () => this.reset();
        this.host.addObstacle = type => this.addObstacle(type);
        this.host.deleteSelectedObstacle = () => this.deleteSelectedObstacle();
        this.host.clearObstacles = () => this.clearObstacles();
        this.host.runProject = () => this.runProject();
        this.host.stopProject = () => this.stopProject();
        this.host.setViewZoom = zoom => this.setViewZoom(zoom);
        this.host.setSpeedMultiplier = multiplier => this.setSpeedMultiplier(multiplier);
        this.ensureRobot(1);
    }

    // Compatibility facade: existing tests and single-root projects may read
    // the former simulator properties directly. They now refer to the active
    // virtual Root while multi-root commands use an explicit session id.
    _activeRobot () { return this.ensureRobot(this.activeId); }
    get pose () { return this._activeRobot().pose; }
    set pose (value) { this._activeRobot().pose = value; this._draw(); }
    get marker () { return this._activeRobot().marker; }
    set marker (value) { this._activeRobot().marker = value; this._draw(); }
    get led () { return this._activeRobot().led; }
    set led (value) { this._activeRobot().led = value; this._draw(); }
    get trail () { return this._activeRobot().trail; }
    get last () { return this._activeRobot().last; }
    get _ledPhase () { return this._activeRobot()._ledPhase; }
    get _collisionPoint () { return this._activeRobot()._collisionPoint; }
    get speedMultiplier () { return this.host.speedMultiplier; }
    get viewZoom () { return this.host.viewZoom; }
    _t (id, defaultText) { return this.host._t(id, defaultText); }
    _setTouchMask (mask) { return this._activeRobot()._setTouchMask(mask); }

    ensureRobot (id) {
        const key = Number(id) || 1;
        if (!this.robots.has(key)) {
            const robot = new RootSimulator(event => this.onEvent && this.onEvent(event, key), {
                isActive: () => this.controls.isActive ? this.controls.isActive() : true,
                translate: this.controls.translate
            });
            robot.obstacles = this.obstacles;
            robot._draw = () => this._draw();
            robot._collisionAt = pose => this._collisionAt(key, pose, robot);
            this.robots.set(key, robot);
        }
        return this.robots.get(key);
    }

    open () { this.host.open(); this._draw(); }
    close () { this.host.close(); }
    isOpen () { return this.host.isOpen(); }
    refresh () { this._draw(); }
    setActiveRoot (id) { this.activeId = Number(id) || 1; this.ensureRobot(this.activeId); this._draw(); }
    setSpeedMultiplier (multiplier) {
        this.host.speedMultiplier = [0.25, 0.5, 1, 2, 4].includes(Number(multiplier)) ? Number(multiplier) : 1;
        for (const robot of this.robots.values()) robot.speedMultiplier = this.host.speedMultiplier;
        this._draw();
    }
    setViewZoom (zoom) {
        this.host.viewZoom = Math.round(clamp(Number(zoom) || 1, 0.25, 2.5) * 4) / 4;
        if (this.host._zoomValue) this.host._zoomValue.textContent = `${Math.round(this.host.viewZoom * 100)}%`;
        this._draw();
        return this.host.viewZoom;
    }
    reset () {
        for (const robot of this.robots.values()) robot.reset();
        this._draw();
    }
    resetRoot (id) { this.ensureRobot(id).reset(); this._draw(); }
    resetNavigation (id) { this.ensureRobot(id).resetNavigation(); this._draw(); }
    motors (id, left, right) { return this.ensureRobot(id).motors(left, right); }
    move (id, distance) { return this.ensureRobot(id).move(distance); }
    turn (id, degrees) { return this.ensureRobot(id).turn(degrees); }
    arc (id, radius, degrees) { return this.ensureRobot(id).arc(radius, degrees); }
    navigateTo (id, x, y) { return this.ensureRobot(id).navigateTo(x, y); }
    stop (id) { return this.ensureRobot(id).stop(); }
    setMarker (id, position) { return this.ensureRobot(id).setMarker(position); }
    setLed (id, effect, red, green, blue) { return this.ensureRobot(id).setLed(effect, red, green, blue); }
    playNote (id, frequency, duration) { return this.ensureRobot(id).playNote(frequency, duration); }
    sayPhrase (id, phrase) { return this.ensureRobot(id).sayPhrase(phrase); }
    getSensor (id, key) { return this.ensureRobot(id).getSensor(key); }
    runProject () {
        if (this.host.controls.isActive && !this.host.controls.isActive()) return false;
        this.reset();
        if (this.host.controls.onRun) this.host.controls.onRun();
        return true;
    }
    stopProject () {
        if (this.host.controls.isActive && !this.host.controls.isActive()) return false;
        if (this.host.controls.onStop) this.host.controls.onStop();
        for (const robot of this.robots.values()) robot.stop();
        return true;
    }
    addObstacle (type) {
        const obstacle = type === 'wall' ?
            {type: 'wall', x: 80, y: 80, width: 120, height: 14} :
            {type: 'block', x: 80, y: 80, width: 50, height: 50};
        this.obstacles.push(obstacle);
        this.host._selectedObstacle = this.obstacles.length - 1;
        this._draw();
        return obstacle;
    }
    deleteSelectedObstacle () {
        const index = this.host._selectedObstacle;
        if (index < 0) return;
        this.obstacles.splice(index, 1);
        this.host._selectedObstacle = -1;
        this._draw();
    }
    clearObstacles () {
        this.obstacles.length = 0;
        this.host._selectedObstacle = -1;
        for (const robot of this.robots.values()) robot._setBumpers(false, false);
        this._draw();
    }
    _collisionAt (id, pose, robot) {
        const obstacleCollision = RootSimulator.prototype._collisionAt.call(robot, pose);
        if (obstacleCollision) return obstacleCollision;
        for (const [otherId, other] of this.robots) {
            if (otherId === id) continue;
            const dx = other.pose.x - pose.x;
            const dy = other.pose.y - pose.y;
            if (dx * dx + dy * dy >= (ROBOT_RADIUS * 2) ** 2) continue;
            const heading = headingRadians(pose.heading);
            const lateral = dx * Math.sin(heading) - dy * Math.cos(heading);
            return {left: lateral <= 0, right: lateral >= 0, x: other.pose.x, y: other.pose.y};
        }
        return null;
    }
    _eventWorld (event) { return this.host._eventWorld(event); }
    _pointerDown (event) {
        if (!this.host._canvas) return;
        const point = this._eventWorld(event);
        const bounds = this.host._canvas.getBoundingClientRect();
        const cx = (event.clientX - bounds.left) * this.host._canvas.width / bounds.width;
        const cy = (event.clientY - bounds.top) * this.host._canvas.height / bounds.height;
        const scale = SCALE * this.host.viewZoom;
        let nearest = null;
        for (const [id, robot] of this.robots) {
            const rx = this.host._canvas.width / 2 + robot.pose.x * scale;
            const ry = this.host._canvas.height / 2 - robot.pose.y * scale;
            const distance = (cx - rx) ** 2 + (cy - ry) ** 2;
            if (distance <= TOUCH_RADIUS ** 2 && (!nearest || distance < nearest.distance)) nearest = {id, robot, distance};
        }
        if (nearest) {
            this.activeId = nearest.id;
            const robot = nearest.robot;
            const dx = point.x - robot.pose.x;
            const dy = point.y - robot.pose.y;
            const heading = headingRadians(robot.pose.heading);
            const forward = dx * Math.cos(heading) + dy * Math.sin(heading);
            const right = dx * Math.sin(heading) - dy * Math.cos(heading);
            robot._activeTouchPointer = event.pointerId;
            robot._setTouchMask(forward >= 0 ? (right < 0 ? 0x8 : 0x4) : (right < 0 ? 0x1 : 0x2));
            this.host._canvas.setPointerCapture(event.pointerId);
            this._draw();
            return;
        }
        this.host._selectedObstacle = -1;
        for (let index = this.obstacles.length - 1; index >= 0; index--) {
            const obstacle = this.obstacles[index];
            if (Math.abs(point.x - obstacle.x) <= obstacle.width / 2 && Math.abs(point.y - obstacle.y) <= obstacle.height / 2) {
                this.host._selectedObstacle = index;
                this.host._dragOffset = {x: point.x - obstacle.x, y: point.y - obstacle.y};
                this.host._canvas.setPointerCapture(event.pointerId);
                break;
            }
        }
        this._draw();
    }
    _pointerMove (event) {
        if (!this.host._dragOffset || this.host._selectedObstacle < 0) return;
        const point = this._eventWorld(event);
        const obstacle = this.obstacles[this.host._selectedObstacle];
        obstacle.x = point.x - this.host._dragOffset.x;
        obstacle.y = point.y - this.host._dragOffset.y;
        this._draw();
    }
    _pointerUp (event) {
        for (const robot of this.robots.values()) {
            if (robot._activeTouchPointer === event.pointerId) {
                robot._activeTouchPointer = null;
                robot._setTouchMask(0);
            }
        }
        this.host._dragOffset = null;
        if (this.host._canvas && this.host._canvas.hasPointerCapture && this.host._canvas.hasPointerCapture(event.pointerId)) {
            this.host._canvas.releasePointerCapture(event.pointerId);
        }
        this._draw();
    }
    _drawRobot (context, robot, point, scale) {
        const p = point(robot.pose);
        context.save(); context.translate(p.x, p.y); context.rotate((90 - robot.pose.heading) * DEG);
        context.fillStyle = '#fff'; context.strokeStyle = '#29343a'; context.lineWidth = 5;
        context.beginPath();
        for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; const x = Math.cos(a) * 36; const y = Math.sin(a) * 36; i ? context.lineTo(x, y) : context.moveTo(x, y); }
        context.closePath(); context.fill(); context.stroke();
        context.lineCap = 'round'; context.lineWidth = 8;
        context.strokeStyle = robot.last.leftBumper ? '#ef3e36' : '#9ba9af'; context.beginPath(); context.moveTo(-2, -35); context.lineTo(-29, -18); context.stroke();
        context.strokeStyle = robot.last.rightBumper ? '#ef3e36' : '#9ba9af'; context.beginPath(); context.moveTo(2, -35); context.lineTo(29, -18); context.stroke();
        for (const sensor of [{x: -13, y: -14, mask: 8}, {x: 13, y: -14, mask: 4}, {x: -13, y: 14, mask: 1}, {x: 13, y: 14, mask: 2}]) {
            context.fillStyle = robot.last.touchMask & sensor.mask ? '#1976d2' : 'rgba(50,160,210,0.2)';
            context.beginPath(); context.arc(sensor.x, sensor.y, 7, 0, Math.PI * 2); context.fill();
        }
        context.strokeStyle = '#29343a'; context.lineWidth = 7; context.beginPath(); context.moveTo(0, -22); context.lineTo(0, 21); context.stroke();
        const color = `rgb(${robot.led.red},${robot.led.green},${robot.led.blue})`;
        if (robot.led.effect === 3) {
            for (let i = 0; i < 4; i++) { const angle = (robot._ledPhase + i * 3) * Math.PI / 6; context.fillStyle = i === 0 ? color : `rgba(${robot.led.red},${robot.led.green},${robot.led.blue},${Math.max(0.15, 0.8 - i * 0.18)})`; context.beginPath(); context.arc(Math.cos(angle) * 17, Math.sin(angle) * 17, 5, 0, Math.PI * 2); context.fill(); }
        } else if (robot.led.effect !== 2 || robot._ledPhase < 6) { context.fillStyle = color; context.beginPath(); context.arc(0, 0, 9, 0, Math.PI * 2); context.fill(); }
        context.fillStyle = '#f2d941'; context.beginPath(); context.arc(0, -27, 6, 0, Math.PI * 2); context.fill();
        context.restore();
    }
    _draw () {
        if (!this.host._context || !this.host._canvas) return;
        const context = this.host._context; const {width, height} = this.host._canvas; const scale = SCALE * this.host.viewZoom;
        const point = ({x, y}) => ({x: width / 2 + x * scale, y: height / 2 - y * scale});
        context.clearRect(0, 0, width, height); context.fillStyle = '#fcfdfd'; context.fillRect(0, 0, width, height);
        context.strokeStyle = '#e0ebe7'; context.lineWidth = 1;
        for (let x = width / 2 % (50 * scale); x < width; x += 50 * scale) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
        for (let y = height / 2 % (50 * scale); y < height; y += 50 * scale) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
        this.obstacles.forEach((obstacle, index) => { const center = point(obstacle); context.fillStyle = obstacle.type === 'wall' ? '#71828a' : '#d9864d'; context.strokeStyle = index === this.host._selectedObstacle ? '#f2c94c' : '#3d4d54'; context.lineWidth = index === this.host._selectedObstacle ? 5 : 3; context.beginPath(); context.rect(center.x - obstacle.width * scale / 2, center.y - obstacle.height * scale / 2, obstacle.width * scale, obstacle.height * scale); context.fill(); context.stroke(); });
        for (const [id, robot] of this.robots) {
            context.strokeStyle = robot.marker === 2 ? '#fff' : (id === this.activeId ? '#22a6a6' : '#8a9bd0'); context.lineWidth = 4; context.lineCap = 'round';
            for (const segment of robot.trail) { const a = point(segment); const b = point({x: segment.x2, y: segment.y2}); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); }
            this._drawRobot(context, robot, point, scale);
            const p = point(robot.pose); context.fillStyle = id === this.activeId ? '#26353a' : '#52646c'; context.font = 'bold 16px Arial'; context.fillText(`Root ${id}`, p.x + 38, p.y - 28);
        }
        const active = this.ensureRobot(this.activeId); context.fillStyle = '#26353a'; context.font = '18px Arial'; context.fillText(`Root ${this.activeId} · ${this.host._t('x', 'x')}: ${active.pose.x.toFixed(1)} mm   ${this.host._t('y', 'y')}: ${active.pose.y.toFixed(1)} mm   ${this.host._t('heading', 'heading')}: ${active.pose.heading.toFixed(1)}°`, 18, 30);
        context.fillText(`${this.host._t('marker', 'marker')}: ${active.marker}   LED: rgb(${active.led.red}, ${active.led.green}, ${active.led.blue})`, 18, 57);
    }
}

export default RootSimulatorWorld;
