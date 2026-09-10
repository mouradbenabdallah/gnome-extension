import GObject from 'gi://GObject';
import St from 'gi://St';
import cairo from 'cairo';

export const Sparkline = GObject.registerClass(
class Sparkline extends St.DrawingArea {
    _init(params = {}) {
        const {
            color = '#00d2ff',
            maxPoints = 24,
            width = 34,
            height = 16,
            ...rest
        } = params;

        super._init({
            style_class: 'sparkline-canvas',
            can_focus: false,
            reactive: false,
            width,
            height,
            ...rest,
        });

        this._maxPoints = maxPoints;
        this._history = new Array(maxPoints).fill(0.0);
        this._color = this._parseHexColor(color);
        this._warnColor = { r: 0.96, g: 0.62, b: 0.07 }; // #f59e0b
        this._alertColor = { r: 0.94, g: 0.27, b: 0.27 }; // #ef4444
    }

    _parseHexColor(hex) {
        let clean = hex.replace('#', '');
        if (clean.length === 3) {
            clean = clean.split('').map(c => c + c).join('');
        }
        const num = parseInt(clean, 16);
        return {
            r: ((num >> 16) & 255) / 255.0,
            g: ((num >> 8) & 255) / 255.0,
            b: (num & 255) / 255.0,
        };
    }

    pushValue(val) {
        const clamped = Math.max(0.0, Math.min(100.0, Number(val) || 0.0));
        this._history.shift();
        this._history.push(clamped);
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();

        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }

        // Clear canvas
        cr.setOperator(cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(cairo.Operator.OVER);

        const len = this._history.length;
        if (len < 2) {
            cr.$dispose();
            return;
        }

        const stepX = w / (this._maxPoints - 1);
        const paddingY = 2.0;
        const usableH = h - (paddingY * 2);

        const points = [];
        for (let i = 0; i < len; i++) {
            const x = i * stepX;
            const normalized = this._history[i] / 100.0;
            const y = (h - paddingY) - (normalized * usableH);
            points.push({ x, y });
        }

        // Determine dynamic line color based on the most recent reading
        const latestVal = this._history[len - 1];
        let activeColor = this._color;
        if (latestVal >= 88.0) {
            activeColor = this._alertColor;
        } else if (latestVal >= 70.0) {
            activeColor = this._warnColor;
        }

        // Draw translucent background fill
        cr.moveTo(points[0].x, h);
        for (let i = 0; i < len; i++) {
            cr.lineTo(points[i].x, points[i].y);
        }
        cr.lineTo(points[len - 1].x, h);
        cr.closePath();

        cr.setSourceRGBA(activeColor.r, activeColor.g, activeColor.b, 0.22);
        cr.fill();

        // Draw antialiased sparkline stroke
        cr.setLineWidth(1.2);
        cr.setLineCap(cairo.LineCap.ROUND);
        cr.setLineJoin(cairo.LineJoin.ROUND);

        cr.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < len; i++) {
            cr.lineTo(points[i].x, points[i].y);
        }

        cr.setSourceRGBA(activeColor.r, activeColor.g, activeColor.b, 0.95);
        cr.stroke();

        // Critical: dispose Cairo context to prevent GJS memory leak
        cr.$dispose();
    }
});
