import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
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
        this._warnColor = { r: 0.90, g: 0.70, b: 0.35 }; // muted amber
        this._alertColor = { r: 0.88, g: 0.40, b: 0.37 }; // muted red
        this._peak = 0.0; // Auto-scaling peak so raw units (KB/s) graph nicely
        this._repaintPending = false;
        this._enabled = true;   // When false, samples are buffered but not drawn
        this._lastPaintTime = 0;
        this._repaintTimeout = 0;
        this._destroyed = false;
        this.connect('destroy', () => {
            this._destroyed = true;
            if (this._repaintTimeout) {
                GLib.source_remove(this._repaintTimeout);
                this._repaintTimeout = 0;
            }
        });
    }

    setEnabled(enabled) {
        if (this._enabled === enabled) return;
        this._enabled = enabled;
        if (enabled && !this._destroyed) this._scheduleRepaint();
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
        const v = Math.max(0.0, Number(val) || 0.0);
        // Skip pushing (and thus repainting) when the sample didn't change:
        // a sparkline that shows the same reading doesn't need a new frame.
        const last = this._history[this._history.length - 1];
        if (Math.abs(v - last) < 0.001) return;
        this._history.shift();
        this._history.push(v);
        // Slowly track the peak so short spikes don't crush the baseline.
        this._peak = Math.max(v, this._peak * 0.97);
        this._scheduleRepaint();
    }

    /** Replaces the whole history window with `values` (e.g. a 30s overview). */
    setData(values) {
        const list = Array.from(values ?? [], (v) => Math.max(0.0, Number(v) || 0.0));
        if (list.length === this._history.length &&
            list.every((v, i) => Math.abs(v - this._history[i]) < 0.001)) {
            return;
        }
        if (list.length > this._maxPoints) {
            this._history = list.slice(list.length - this._maxPoints);
        } else {
            this._history = new Array(this._maxPoints - list.length).fill(0.0).concat(list);
        }
        this._peak = Math.max(...this._history, this._peak * 0.97, 1.0);
        this._scheduleRepaint();
    }

    _scheduleRepaint() {
        if (!this._enabled || this._destroyed || this._repaintPending) return;
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastPaintTime < 120) {
            // Coalesce bursts of samples into a single deferred repaint.
            if (!this._repaintTimeout) {
                this._repaintTimeout = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT_IDLE,
                    120,
                    () => {
                        this._repaintTimeout = 0;
                        this._scheduleRepaint();
                        return GLib.SOURCE_REMOVE;
                    },
                );
            }
            return;
        }
        this._repaintPending = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._repaintPending = false;
            if (this._destroyed) return GLib.SOURCE_REMOVE;
            this._lastPaintTime = GLib.get_monotonic_time() / 1000;
            this.queue_repaint();
            return GLib.SOURCE_REMOVE;
        });
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
        const maxVal = Math.max(this._peak, 1.0);
        if (len < 2) {
            cr.$dispose();
            return;
        }

        const stepX = w / (this._maxPoints - 1);
        const paddingY = 2.0;
        const usableH = h - (paddingY * 2);

        // Determine dynamic line color based on the most recent reading.
        const latestVal = this._history[len - 1];
        const latestFrac = latestVal / maxVal;
        let activeColor = this._color;
        if (latestFrac >= 0.88) {
            activeColor = this._alertColor;
        } else if (latestFrac >= 0.7) {
            activeColor = this._warnColor;
        }

        // Downsample the history so a frame never draws more samples than the
        // canvas can resolve (painting cost stays bounded by the pixel width).
        const stride = Math.max(1, Math.ceil(len / Math.max(2, Math.floor(w))));
        const xs = [];
        const ys = [];
        for (let i = 0; i < len; i += stride) {
            const x = i * stepX;
            const normalized = Math.min(1.0, this._history[i] / maxVal);
            xs.push(x);
            ys.push((h - paddingY) - (normalized * usableH));
        }
        // Always keep the freshest sample on screen, even with stride > 1.
        const lastX = (len - 1) * stepX;
        if (xs[xs.length - 1] !== lastX) {
            xs.push(lastX);
            ys.push((h - paddingY) - (latestFrac * usableH));
        }
        if (xs.length < 2) {
            cr.$dispose();
            return;
        }

        // Gradient fill under the line: weighted at the trace, dissolving to
        // transparent at the baseline so the sparkline carries real weight.
        const grad = cr.createLinearGradient(0, paddingY, 0, h);
        grad.addColorStopRGBA(0, activeColor.r, activeColor.g, activeColor.b, 0.32);
        grad.addColorStopRGBA(1, activeColor.r, activeColor.g, activeColor.b, 0.02);
        cr.moveTo(xs[0], h);
        for (let i = 0; i < xs.length; i++) {
            cr.lineTo(xs[i], ys[i]);
        }
        cr.lineTo(xs[xs.length - 1], h);
        cr.closePath();
        cr.setSource(grad);
        cr.fill();

        // Draw a heavier, antialiased sparkline stroke so the trend reads at
        // a glance instead of looking like pure decoration.
        cr.setLineWidth(1.8);
        cr.setLineCap(cairo.LineCap.ROUND);
        cr.setLineJoin(cairo.LineJoin.ROUND);

        cr.moveTo(xs[0], ys[0]);
        for (let i = 1; i < xs.length; i++) {
            cr.lineTo(xs[i], ys[i]);
        }

        cr.setSourceRGBA(activeColor.r, activeColor.g, activeColor.b, 0.95);
        cr.stroke();

        // Critical: dispose Cairo context to prevent GJS memory leak
        cr.$dispose();
    }
});