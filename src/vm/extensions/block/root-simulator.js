/*
 * Root's simulator is deliberately independent from Scratch targets, costumes,
 * and the Pen extension.  This keeps the extension usable from the official
 * Xcratch editor as a normal external extension.
 */

const DEG = Math.PI / 180;
const DEFAULT_HEADING = 90;
const DEFAULT_SPEED_MM_S = 120;
const DEFAULT_TURN_DEG_S = 120;
const SIMULATOR_SCALE = 1.8;
const ROOT_COLLISION_RADIUS_MM = 24;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const headingRadians = heading => heading * DEG;
const normalizeHeading = heading => ((heading % 360) + 360) % 360;

class RootSimulator {
    constructor (onEvent) {
        this.onEvent = onEvent;
        this.speedMultiplier = 1;
        this._animation = null;
        this._continuousMotion = null;
        this._ledAnimationTimer = null;
        this._ledPhase = 0;
        this._panel = null;
        this._canvas = null;
        this._context = null;
        this._selectedObstacle = -1;
        this._dragOffset = null;
        this._activeTouchPointer = null;
        this._collisionPoint = null;
        this.reset();
    }

    reset () {
        this.stop();
        this._stopLedAnimation();
        this.pose = {x: 0, y: 0, heading: DEFAULT_HEADING};
        this.marker = 0;
        this.led = {effect: 0, red: 0, green: 0, blue: 0};
        this.note = null;
        this.phrase = '';
        this.trail = [];
        if (!this.obstacles) this.obstacles = [];
        this._selectedObstacle = -1;
        this._collisionPoint = null;
        this.last = {
            batteryPercent: 100,
            batteryMv: 7400,
            lightLeft: 0,
            lightRight: 0,
            accelX: 0,
            accelY: 0,
            accelZ: 1000,
            leftBumper: false,
            rightBumper: false,
            touchMask: 0,
            cliff: false
        };
        this._draw();
    }

    resetNavigation () {
        this.stop();
        this._setBumpers(false, false);
        this.pose = {x: 0, y: 0, heading: DEFAULT_HEADING};
        this._draw();
    }

    addObstacle (type = 'block') {
        const obstacle = type === 'wall' ?
            {type: 'wall', x: 80, y: 80, width: 120, height: 14} :
            {type: 'block', x: 80, y: 80, width: 50, height: 50};
        this.obstacles.push(obstacle);
        this._selectedObstacle = this.obstacles.length - 1;
        this._draw();
        return obstacle;
    }

    deleteSelectedObstacle () {
        if (this._selectedObstacle < 0) return;
        this.obstacles.splice(this._selectedObstacle, 1);
        this._selectedObstacle = -1;
        this._draw();
    }

    clearObstacles () {
        this.obstacles = [];
        this._selectedObstacle = -1;
        this._setBumpers(false, false);
        this._draw();
    }

    setSpeedMultiplier (multiplier) {
        this.speedMultiplier = [0.25, 0.5, 1, 2, 4].includes(Number(multiplier)) ? Number(multiplier) : 1;
    }

    open () {
        if (typeof document === 'undefined') return;
        if (!this._panel) this._createPanel();
        this._panel.style.display = 'flex';
        this._draw();
    }

    close () {
        if (this._panel) this._panel.style.display = 'none';
    }

    isOpen () {
        return Boolean(this._panel && this._panel.style.display !== 'none');
    }

    setMarker (position) {
        this.marker = clamp(Math.round(Number(position) || 0), 0, 2);
        this._draw();
    }

    setLed (effect, red, green, blue) {
        this._stopLedAnimation();
        this.led = {
            effect: clamp(Math.round(Number(effect) || 0), 0, 3),
            red: clamp(Math.round(Number(red) || 0), 0, 255),
            green: clamp(Math.round(Number(green) || 0), 0, 255),
            blue: clamp(Math.round(Number(blue) || 0), 0, 255)
        };
        this._ledPhase = 0;
        if (this.led.effect === 2 || this.led.effect === 3) {
            this._ledAnimationTimer = setInterval(() => {
                this._ledPhase = (this._ledPhase + 1) % 12;
                this._draw();
            }, 100);
        }
        this._draw();
    }

    playNote (frequency, durationMs) {
        this.note = {frequency, until: Date.now() + durationMs};
        this._draw();
        return this._wait(Math.max(0, durationMs));
    }

    sayPhrase (phrase) {
        this.phrase = String(phrase || '');
        this._draw();
        return this._wait(Math.min(30000, Math.max(250, this.phrase.length * 110)));
    }

    move (distanceMm) {
        const distance = Number(distanceMm) || 0;
        const start = Object.assign({}, this.pose);
        const radians = headingRadians(start.heading);
        const end = {
            x: start.x + Math.cos(radians) * distance,
            y: start.y + Math.sin(radians) * distance,
            heading: start.heading
        };
        return this._animate(Math.abs(distance) / DEFAULT_SPEED_MM_S * 1000, progress => {
            this._setPose({
                x: start.x + (end.x - start.x) * progress,
                y: start.y + (end.y - start.y) * progress,
                heading: start.heading
            });
        });
    }

    turn (degrees) {
        const turn = Number(degrees) || 0;
        const start = Object.assign({}, this.pose);
        return this._animate(Math.abs(turn) / DEFAULT_TURN_DEG_S * 1000, progress => {
            // Root defines a positive rotation as clockwise.
            this._setPose(Object.assign({}, start, {heading: normalizeHeading(start.heading - turn * progress)}));
        });
    }

    arc (radiusMm, degrees) {
        const radius = Number(radiusMm) || 0;
        const angle = Number(degrees) || 0;
        if (radius === 0) return this.turn(angle);
        const start = Object.assign({}, this.pose);
        const theta = headingRadians(start.heading);
        // Positive Root angles are clockwise. A positive radius therefore
        // describes the right-hand circle seen by a Root facing forward.
        const center = {
            x: start.x + radius * Math.sin(theta),
            y: start.y - radius * Math.cos(theta)
        };
        const duration = Math.abs(radius * angle * DEG) / DEFAULT_SPEED_MM_S * 1000;
        return this._animate(duration, progress => {
            const heading = normalizeHeading(start.heading - angle * progress);
            const currentTheta = headingRadians(heading);
            this._setPose({
                x: center.x - radius * Math.sin(currentTheta),
                y: center.y + radius * Math.cos(currentTheta),
                heading
            });
        });
    }

    motors (left, right) {
        this._stopContinuousMotion();
        const leftPower = clamp(Number(left) || 0, -100, 100);
        const rightPower = clamp(Number(right) || 0, -100, 100);
        if (leftPower === 0 && rightPower === 0) return;
        let previous = Date.now();
        this._continuousMotion = setInterval(() => {
            const now = Date.now();
            const elapsed = Math.min(100, now - previous) / 1000;
            previous = now;
            const linear = ((leftPower + rightPower) / 2) * 1.2 * this.speedMultiplier;
            const angular = ((rightPower - leftPower) * 1.2 * this.speedMultiplier / 86) / DEG;
            const nextHeading = normalizeHeading(this.pose.heading - angular * elapsed);
            const radians = headingRadians((this.pose.heading + nextHeading) / 2);
            this._setPose({
                x: this.pose.x + Math.cos(radians) * linear * elapsed,
                y: this.pose.y + Math.sin(radians) * linear * elapsed,
                heading: nextHeading
            });
        }, 16);
    }

    stop () {
        if (this._animation) {
            this._animation.cancelled = true;
            this._animation.resolve();
            this._animation = null;
        }
        this._stopContinuousMotion();
        this._draw();
    }

    navigateTo (xMm, yMm) {
        const deltaX = (Number(xMm) || 0) - this.pose.x;
        const deltaY = (Number(yMm) || 0) - this.pose.y;
        const distance = Math.hypot(deltaX, deltaY);
        if (distance < 0.01) return Promise.resolve();
        const targetHeading = normalizeHeading(Math.atan2(deltaY, deltaX) / DEG);
        const turn = normalizeHeading(this.pose.heading - targetHeading + 180) - 180;
        return this.turn(turn).then(() => this.move(distance));
    }

    getSensor (key) {
        return this.last[key] === undefined ? 0 : this.last[key];
    }

    _setPose (pose) {
        const previous = this.pose;
        const deltaX = pose.x - previous.x;
        const deltaY = pose.y - previous.y;
        const steps = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaY) / (ROOT_COLLISION_RADIUS_MM / 2)));
        let accepted = previous;
        for (let step = 1; step <= steps; step++) {
            const progress = step / steps;
            const candidate = {
                x: previous.x + deltaX * progress,
                y: previous.y + deltaY * progress,
                heading: normalizeHeading(previous.heading + (pose.heading - previous.heading) * progress)
            };
            const collision = this._collisionAt(candidate);
            if (collision) {
                this._collisionPoint = {x: collision.x, y: collision.y};
                this._setBumpers(collision.left, collision.right);
                if (accepted !== previous) this._commitPose(previous, accepted);
                this._draw();
                return false;
            }
            accepted = candidate;
        }
        this._setBumpers(false, false);
        this._commitPose(previous, pose);
        this._draw();
        return true;
    }

    _commitPose (previous, pose) {
        this.pose = pose;
        if (this.marker === 1 && (previous.x !== pose.x || previous.y !== pose.y)) {
            this.trail.push({x1: previous.x, y1: previous.y, x2: pose.x, y2: pose.y});
        }
    }

    _collisionAt (pose) {
        for (const obstacle of this.obstacles) {
            const halfWidth = obstacle.width / 2;
            const halfHeight = obstacle.height / 2;
            const closestX = clamp(pose.x, obstacle.x - halfWidth, obstacle.x + halfWidth);
            const closestY = clamp(pose.y, obstacle.y - halfHeight, obstacle.y + halfHeight);
            let dx = closestX - pose.x;
            let dy = closestY - pose.y;
            if ((dx * dx) + (dy * dy) >= ROOT_COLLISION_RADIUS_MM * ROOT_COLLISION_RADIUS_MM) continue;
            if (dx === 0 && dy === 0) {
                dx = obstacle.x - pose.x;
                dy = obstacle.y - pose.y;
            }
            const heading = headingRadians(pose.heading);
            const rightX = Math.sin(heading);
            const rightY = -Math.cos(heading);
            const lateral = (dx * rightX) + (dy * rightY);
            const centerThreshold = ROOT_COLLISION_RADIUS_MM * 0.22;
            return {
                left: lateral <= centerThreshold,
                right: lateral >= -centerThreshold,
                x: closestX,
                y: closestY
            };
        }
        return null;
    }

    _setBumpers (left, right) {
        const nextLeft = Boolean(left);
        const nextRight = Boolean(right);
        if (this.last.leftBumper === nextLeft && this.last.rightBumper === nextRight) return;
        this.last.leftBumper = nextLeft;
        this.last.rightBumper = nextRight;
        if (!nextLeft && !nextRight) this._collisionPoint = null;
        if (this.onEvent) this.onEvent({type: 'bumper', left: nextLeft, right: nextRight});
    }

    _setTouchMask (mask) {
        const next = mask & 0xF;
        if (this.last.touchMask === next) return;
        this.last.touchMask = next;
        if (this.onEvent) this.onEvent({type: 'touch', mask: next});
    }

    _animate (durationMs, update) {
        this.stop();
        const duration = Math.max(0, durationMs / this.speedMultiplier);
        if (duration === 0) {
            update(1);
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const animation = {cancelled: false, resolve};
            this._animation = animation;
            const start = Date.now();
            const frame = () => {
                if (animation.cancelled) return;
                const progress = Math.min(1, (Date.now() - start) / duration);
                update(progress);
                if (progress < 1) {
                    animation.frame = setTimeout(frame, 16);
                } else {
                    this._animation = null;
                    resolve();
                }
            };
            frame();
        });
    }

    _wait (durationMs) {
        return new Promise(resolve => setTimeout(resolve, durationMs / this.speedMultiplier));
    }

    _stopContinuousMotion () {
        if (this._continuousMotion) clearInterval(this._continuousMotion);
        this._continuousMotion = null;
    }

    _stopLedAnimation () {
        if (this._ledAnimationTimer) clearInterval(this._ledAnimationTimer);
        this._ledAnimationTimer = null;
        this._ledPhase = 0;
    }

    _createPanel () {
        const panel = document.createElement('div');
        panel.setAttribute('data-irobot-root-simulator', '');
        panel.style.cssText = 'position:fixed;z-index:10000;inset:4vh 4vw;background:#f7fbf9;border:3px solid #39846c;border-radius:18px;box-shadow:0 14px 40px #0008;display:flex;flex-direction:column;overflow:hidden;font-family:Arial,sans-serif;';
        const header = document.createElement('div');
        header.style.cssText = 'padding:12px 18px;background:#39846c;color:white;font-size:20px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;';
        header.appendChild(document.createTextNode('iRobot Root Simulator'));
        const close = document.createElement('button');
        close.textContent = '×';
        close.style.cssText = 'border:0;border-radius:50%;width:34px;height:34px;background:#286754;color:white;font-size:27px;line-height:28px;';
        close.onclick = () => this.close();
        header.appendChild(close);
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'padding:8px 12px;background:#e8f4f0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
        const addButton = (label, action) => {
            const button = document.createElement('button');
            button.textContent = label;
            button.style.cssText = 'border:2px solid #39846c;border-radius:8px;padding:6px 12px;background:white;color:#264c40;font-weight:bold;cursor:pointer;';
            button.onclick = action;
            toolbar.appendChild(button);
            return button;
        };
        addButton('+ Wall', () => this.addObstacle('wall'));
        addButton('+ Block', () => this.addObstacle('block'));
        addButton('Delete', () => this.deleteSelectedObstacle());
        addButton('Clear obstacles', () => this.clearObstacles());
        const speedLabel = document.createElement('label');
        speedLabel.textContent = 'Speed ';
        speedLabel.style.cssText = 'color:#264c40;font-weight:bold;';
        const speedSelect = document.createElement('select');
        speedSelect.style.cssText = 'border:2px solid #39846c;border-radius:8px;padding:6px;background:white;color:#264c40;font-weight:bold;';
        for (const speed of [0.25, 0.5, 1, 2, 4]) {
            const option = document.createElement('option');
            option.value = String(speed);
            option.textContent = `${speed}×`;
            option.selected = speed === this.speedMultiplier;
            speedSelect.appendChild(option);
        }
        speedSelect.onchange = () => this.setSpeedMultiplier(speedSelect.value);
        speedLabel.appendChild(speedSelect);
        toolbar.appendChild(speedLabel);
        const help = document.createElement('span');
        help.textContent = 'Drag obstacles · Tap Root sensors';
        help.style.cssText = 'margin-left:auto;color:#42675b;font-size:14px;';
        toolbar.appendChild(help);
        const canvas = document.createElement('canvas');
        canvas.width = 1000;
        canvas.height = 680;
        canvas.style.cssText = 'width:100%;height:calc(100% - 108px);touch-action:none;background:#fff;';
        canvas.addEventListener('pointerdown', event => this._pointerDown(event));
        canvas.addEventListener('pointermove', event => this._pointerMove(event));
        canvas.addEventListener('pointerup', event => this._pointerUp(event));
        canvas.addEventListener('pointercancel', event => this._pointerUp(event));
        panel.tabIndex = 0;
        panel.addEventListener('keydown', event => {
            if (event.key === 'Backspace' || event.key === 'Delete') this.deleteSelectedObstacle();
        });
        panel.appendChild(header);
        panel.appendChild(toolbar);
        panel.appendChild(canvas);
        document.body.appendChild(panel);
        this._panel = panel;
        this._canvas = canvas;
        this._context = canvas.getContext('2d');
    }

    _eventWorld (event) {
        const bounds = this._canvas.getBoundingClientRect();
        const canvasX = (event.clientX - bounds.left) * this._canvas.width / bounds.width;
        const canvasY = (event.clientY - bounds.top) * this._canvas.height / bounds.height;
        return {
            x: (canvasX - this._canvas.width / 2) / SIMULATOR_SCALE,
            y: (this._canvas.height / 2 - canvasY) / SIMULATOR_SCALE
        };
    }

    _pointerDown (event) {
        const point = this._eventWorld(event);
        const dx = point.x - this.pose.x;
        const dy = point.y - this.pose.y;
        if ((dx * dx) + (dy * dy) <= ROOT_COLLISION_RADIUS_MM * ROOT_COLLISION_RADIUS_MM) {
            const heading = headingRadians(this.pose.heading);
            const forward = (dx * Math.cos(heading)) + (dy * Math.sin(heading));
            const right = (dx * Math.sin(heading)) - (dy * Math.cos(heading));
            const mask = forward >= 0 ? (right < 0 ? 0x8 : 0x4) : (right < 0 ? 0x1 : 0x2);
            this._activeTouchPointer = event.pointerId;
            this._setTouchMask(mask);
            this._canvas.setPointerCapture(event.pointerId);
            this._draw();
            return;
        }
        this._selectedObstacle = -1;
        for (let index = this.obstacles.length - 1; index >= 0; index--) {
            const obstacle = this.obstacles[index];
            if (Math.abs(point.x - obstacle.x) <= obstacle.width / 2 &&
                Math.abs(point.y - obstacle.y) <= obstacle.height / 2) {
                this._selectedObstacle = index;
                this._dragOffset = {x: point.x - obstacle.x, y: point.y - obstacle.y};
                this._canvas.setPointerCapture(event.pointerId);
                break;
            }
        }
        this._draw();
    }

    _pointerMove (event) {
        if (!this._dragOffset || this._selectedObstacle < 0) return;
        const point = this._eventWorld(event);
        const obstacle = this.obstacles[this._selectedObstacle];
        obstacle.x = point.x - this._dragOffset.x;
        obstacle.y = point.y - this._dragOffset.y;
        this._draw();
    }

    _pointerUp (event) {
        if (this._activeTouchPointer === event.pointerId) {
            this._activeTouchPointer = null;
            this._setTouchMask(0);
        }
        this._dragOffset = null;
        if (this._canvas.hasPointerCapture && this._canvas.hasPointerCapture(event.pointerId)) {
            this._canvas.releasePointerCapture(event.pointerId);
        }
        this._draw();
    }

    _draw () {
        if (!this._context || !this._canvas) return;
        const context = this._context;
        const {width, height} = this._canvas;
        const scale = SIMULATOR_SCALE;
        const point = ({x, y}) => ({x: width / 2 + x * scale, y: height / 2 - y * scale});
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#fcfdfd'; context.fillRect(0, 0, width, height);
        context.strokeStyle = '#e0ebe7'; context.lineWidth = 1;
        for (let x = width / 2 % (50 * scale); x < width; x += 50 * scale) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
        for (let y = height / 2 % (50 * scale); y < height; y += 50 * scale) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
        this.obstacles.forEach((obstacle, index) => {
            const center = point(obstacle);
            const obstacleWidth = obstacle.width * scale;
            const obstacleHeight = obstacle.height * scale;
            context.fillStyle = obstacle.type === 'wall' ? '#71828a' : '#d9864d';
            context.strokeStyle = index === this._selectedObstacle ? '#f2c94c' : '#3d4d54';
            context.lineWidth = index === this._selectedObstacle ? 5 : 3;
            context.beginPath();
            context.rect(
                center.x - obstacleWidth / 2,
                center.y - obstacleHeight / 2,
                obstacleWidth,
                obstacleHeight
            );
            context.fill();
            context.stroke();
        });
        if (this._collisionPoint) {
            const collisionPoint = point(this._collisionPoint);
            context.strokeStyle = '#ef3e36';
            context.fillStyle = 'rgba(239,62,54,0.25)';
            context.lineWidth = 4;
            context.beginPath(); context.arc(collisionPoint.x, collisionPoint.y, 12, 0, Math.PI * 2);
            context.fill(); context.stroke();
            context.beginPath();
            context.moveTo(collisionPoint.x - 8, collisionPoint.y - 8);
            context.lineTo(collisionPoint.x + 8, collisionPoint.y + 8);
            context.moveTo(collisionPoint.x + 8, collisionPoint.y - 8);
            context.lineTo(collisionPoint.x - 8, collisionPoint.y + 8);
            context.stroke();
        }
        context.strokeStyle = this.marker === 2 ? '#fff' : '#22a6a6'; context.lineWidth = 4; context.lineCap = 'round';
        for (const segment of this.trail) { const a = point({x: segment.x1, y: segment.y1}); const b = point({x: segment.x2, y: segment.y2}); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); }
        const p = point(this.pose);
        context.save(); context.translate(p.x, p.y); context.rotate((90 - this.pose.heading) * DEG);
        context.fillStyle = '#fff'; context.strokeStyle = '#29343a'; context.lineWidth = 5;
        context.beginPath();
        for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; const x = Math.cos(a) * 36; const y = Math.sin(a) * 36; i ? context.lineTo(x, y) : context.moveTo(x, y); }
        context.closePath(); context.fill(); context.stroke();
        context.lineCap = 'round';
        context.lineWidth = 8;
        context.strokeStyle = this.last.leftBumper ? '#ef3e36' : '#9ba9af';
        context.beginPath(); context.moveTo(-2, -35); context.lineTo(-29, -18); context.stroke();
        context.strokeStyle = this.last.rightBumper ? '#ef3e36' : '#9ba9af';
        context.beginPath(); context.moveTo(2, -35); context.lineTo(29, -18); context.stroke();
        const touchSensors = [
            {x: -13, y: -14, mask: 0x8}, {x: 13, y: -14, mask: 0x4},
            {x: -13, y: 14, mask: 0x1}, {x: 13, y: 14, mask: 0x2}
        ];
        for (const sensor of touchSensors) {
            context.fillStyle = this.last.touchMask & sensor.mask ? '#1976d2' : 'rgba(50,160,210,0.2)';
            context.beginPath(); context.arc(sensor.x, sensor.y, 7, 0, Math.PI * 2); context.fill();
        }
        context.strokeStyle = '#29343a'; context.lineWidth = 7; context.beginPath(); context.moveTo(0, -22); context.lineTo(0, 21); context.stroke();
        const ledColor = `rgb(${this.led.red},${this.led.green},${this.led.blue})`;
        if (this.led.effect === 3) {
            for (let i = 0; i < 4; i++) {
                const angle = (this._ledPhase + i * 3) * Math.PI / 6;
                context.fillStyle = i === 0 ? ledColor : `rgba(${this.led.red},${this.led.green},${this.led.blue},${Math.max(0.15, 0.8 - i * 0.18)})`;
                context.beginPath();
                context.arc(Math.cos(angle) * 17, Math.sin(angle) * 17, 5, 0, Math.PI * 2);
                context.fill();
            }
        } else if (this.led.effect !== 2 || this._ledPhase < 6) {
            context.fillStyle = ledColor; context.beginPath(); context.arc(0, 0, 9, 0, Math.PI * 2); context.fill();
        }
        context.fillStyle = '#f2d941'; context.beginPath(); context.arc(0, -27, 6, 0, Math.PI * 2); context.fill();
        context.restore();
        context.fillStyle = '#26353a'; context.font = '18px Arial';
        context.fillText(`x: ${this.pose.x.toFixed(1)} mm   y: ${this.pose.y.toFixed(1)} mm   heading: ${this.pose.heading.toFixed(1)}°`, 18, 30);
        context.fillText(`marker: ${['up', 'down', 'eraser'][this.marker]}   LED: ${['off', 'on', 'blink', 'spin'][this.led.effect]} rgb(${this.led.red}, ${this.led.green}, ${this.led.blue})`, 18, 57);
        const bumper = this.last.leftBumper && this.last.rightBumper ? 'BOTH PUSH' :
            (this.last.leftBumper ? 'LEFT PUSH' : (this.last.rightBumper ? 'RIGHT PUSH' : 'none'));
        context.fillText(`bumper: ${bumper}   touch mask: ${this.last.touchMask.toString(2).padStart(4, '0')}`, 18, 84);
        if (this.phrase) context.fillText(`say: ${this.phrase}`, 18, 111);
    }
}

export default RootSimulator;
