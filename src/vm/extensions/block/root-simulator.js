/*
 * Root's simulator is deliberately independent from Scratch targets, costumes,
 * and the Pen extension.  This keeps the extension usable from the official
 * Xcratch editor as a normal external extension.
 */

const DEG = Math.PI / 180;
const DEFAULT_HEADING = 90;
const DEFAULT_SPEED_MM_S = 120;
const DEFAULT_TURN_DEG_S = 120;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const headingRadians = heading => heading * DEG;
const normalizeHeading = heading => ((heading % 360) + 360) % 360;

class RootSimulator {
    constructor (onEvent) {
        this.onEvent = onEvent;
        this.speedMultiplier = 2;
        this._animation = null;
        this._continuousMotion = null;
        this._panel = null;
        this._canvas = null;
        this._context = null;
        this.reset();
    }

    reset () {
        this.stop();
        this.pose = {x: 0, y: 0, heading: DEFAULT_HEADING};
        this.marker = 0;
        this.led = {effect: 0, red: 0, green: 0, blue: 0};
        this.note = null;
        this.phrase = '';
        this.trail = [];
        this.obstacles = [];
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
        this.led = {
            effect: clamp(Math.round(Number(effect) || 0), 0, 3),
            red: clamp(Math.round(Number(red) || 0), 0, 255),
            green: clamp(Math.round(Number(green) || 0), 0, 255),
            blue: clamp(Math.round(Number(blue) || 0), 0, 255)
        };
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
            const linear = ((leftPower + rightPower) / 2) * 1.2;
            const angular = ((rightPower - leftPower) * 1.2 / 86) / DEG;
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
        this.pose = pose;
        if (this.marker === 1 && (previous.x !== pose.x || previous.y !== pose.y)) {
            this.trail.push({x1: previous.x, y1: previous.y, x2: pose.x, y2: pose.y});
        }
        this._draw();
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
        const canvas = document.createElement('canvas');
        canvas.width = 1000;
        canvas.height = 680;
        canvas.style.cssText = 'width:100%;height:calc(100% - 58px);touch-action:none;background:#fff;';
        panel.appendChild(header);
        panel.appendChild(canvas);
        document.body.appendChild(panel);
        this._panel = panel;
        this._canvas = canvas;
        this._context = canvas.getContext('2d');
    }

    _draw () {
        if (!this._context || !this._canvas) return;
        const context = this._context;
        const {width, height} = this._canvas;
        const scale = 1.8;
        const point = ({x, y}) => ({x: width / 2 + x * scale, y: height / 2 - y * scale});
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#fcfdfd'; context.fillRect(0, 0, width, height);
        context.strokeStyle = '#e0ebe7'; context.lineWidth = 1;
        for (let x = width / 2 % (50 * scale); x < width; x += 50 * scale) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
        for (let y = height / 2 % (50 * scale); y < height; y += 50 * scale) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
        context.strokeStyle = this.marker === 2 ? '#fff' : '#22a6a6'; context.lineWidth = 4; context.lineCap = 'round';
        for (const segment of this.trail) { const a = point({x: segment.x1, y: segment.y1}); const b = point({x: segment.x2, y: segment.y2}); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); }
        const p = point(this.pose);
        context.save(); context.translate(p.x, p.y); context.rotate((90 - this.pose.heading) * DEG);
        context.fillStyle = '#fff'; context.strokeStyle = '#29343a'; context.lineWidth = 5;
        context.beginPath();
        for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; const x = Math.cos(a) * 36; const y = Math.sin(a) * 36; i ? context.lineTo(x, y) : context.moveTo(x, y); }
        context.closePath(); context.fill(); context.stroke();
        context.strokeStyle = '#29343a'; context.lineWidth = 7; context.beginPath(); context.moveTo(0, -22); context.lineTo(0, 21); context.stroke();
        context.fillStyle = `rgb(${this.led.red},${this.led.green},${this.led.blue})`; context.beginPath(); context.arc(0, 0, 9, 0, Math.PI * 2); context.fill();
        context.fillStyle = '#f2d941'; context.beginPath(); context.arc(0, -27, 6, 0, Math.PI * 2); context.fill();
        context.restore();
        context.fillStyle = '#26353a'; context.font = '18px Arial';
        context.fillText(`x: ${this.pose.x.toFixed(1)} mm   y: ${this.pose.y.toFixed(1)} mm   heading: ${this.pose.heading.toFixed(1)}°`, 18, 30);
        context.fillText(`marker: ${['up', 'down', 'eraser'][this.marker]}   LED: rgb(${this.led.red}, ${this.led.green}, ${this.led.blue})`, 18, 57);
        if (this.phrase) context.fillText(`say: ${this.phrase}`, 18, 84);
    }
}

export default RootSimulator;
