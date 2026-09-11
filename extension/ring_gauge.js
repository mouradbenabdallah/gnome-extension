import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import cairo from 'cairo';

/**
 * Codenotch Palette Colors
 */
const PALETTE = {
    ringTrack: { r: 1.0, g: 1.0, b: 1.0, a: 0.18 },
    ample:     { r: 0.0, g: 1.0, b: 0.533, a: 1.0 },   // #00FF88 (under 50%)
    watch:     { r: 0.949, g: 1.0, b: 0.0, a: 1.0 },   // #F2FF00 (50% - 75%)
    critical:  { r: 1.0, g: 0.247, b: 0.0, a: 1.0 },   // #FF3F00 (75% - 90%)
    exhausted: { r: 1.0, g: 0.271, b: 0.227, a: 1.0 }, // #FF453A (> 90%)
    glyphIdle: { r: 1.0, g: 1.0, b: 1.0, a: 0.82 },
};

// Apple-style monochrome accent used for all load bands.
const PALETTE_MONO = {
    ringTrack: { r: 1.0, g: 1.0, b: 1.0, a: 0.16 },
    band:      { r: 0.49, g: 0.65, b: 1.0, a: 1.0 },   // #7DA6FF
    glyphIdle: { r: 1.0, g: 1.0, b: 1.0, a: 0.82 },
};

export const RingGauge = GObject.registerClass(
class RingGauge extends St.DrawingArea {
    _init(params = {}) {
        const {
            type = 'cpu',      // 'cpu', 'ram', or 'fan'
            size = 30,
            strokeWidth = 3.0,
            palette = 'codenotch',
            ...rest
        } = params;

        super._init({
            style_class: 'codenotch-ring-gauge',
            can_focus: false,
            reactive: false,
            width: size,
            height: size,
            ...rest,
        });

        this._type = type;
        this._size = size;
        this._strokeWidth = strokeWidth;
        this._palette = palette;
        this._value = 0.0;        // Animated (displayed) value, 0.0 to 100.0
        this._targetValue = 0.0;  // Desired value, 0.0 to 100.0
        this._fanAngle = 0.0;     // Rotation angle for fan blades
        this._animSource = 0;     // Smooth value interpolation timer
        this._fanSource = 0;      // Continuous fan blade spin timer

        this.connect('destroy', () => this._stopAnimSources());
    }

    setValue(val) {
        const target = Math.max(0.0, Math.min(100.0, Number(val) || 0.0));
        this._targetValue = target;

        // Fan blades spin continuously while the fan is moving.
        if (this._type === 'fan') {
            if (target > 0)
                this._ensureFanSpin();
            else
                this._stopFanSpin();
        }

        // Animate the ring arc smoothly toward the target value.
        if (!this._animSource) {
            if (Math.abs(this._value - this._targetValue) < 0.2) {
                this._value = this._targetValue;
                this.queue_repaint();
                return;
            }
            this._animSource = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                32,
                () => this._animateStep()
            );
        }
    }

    _ensureFanSpin() {
        if (this._fanSource)
            return;

        this._fanSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
            const pct = this._value / 100.0;
            if (pct <= 0.001) {
                this._stopFanSpin();
                return GLib.SOURCE_REMOVE;
            }
            // Gentle idle rotation that speeds up with fan %, ~1-2 rev/s
            const step = 0.05 + pct * 0.38;
            this._fanAngle = (this._fanAngle + step) % (Math.PI * 2);
            this.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopFanSpin() {
        if (this._fanSource) {
            GLib.source_remove(this._fanSource);
            this._fanSource = 0;
        }
    }

    _animateStep() {
        const diff = this._targetValue - this._value;
        if (Math.abs(diff) <= 0.15) {
            this._value = this._targetValue;
            this._animSource = 0;
            this.queue_repaint();
            return GLib.SOURCE_REMOVE;
        }
        this._value += diff * 0.18;
        this.queue_repaint();
        return GLib.SOURCE_CONTINUE;
    }

    _stopAnimSources() {
        this._stopFanSpin();
        if (this._animSource) {
            GLib.source_remove(this._animSource);
            this._animSource = 0;
        }
    }

    setPalette(palette) {
        if (this._palette !== palette) {
            this._palette = palette;
            this.queue_repaint();
        }
    }

    _getBandColor(fraction) {
        if (this._palette === 'mono') {
            return PALETTE_MONO.band;
        }
        if (fraction < 0.50) {
            return PALETTE.ample;
        } else if (fraction < 0.75) {
            return PALETTE.watch;
        } else if (fraction < 0.90) {
            return PALETTE.critical;
        } else {
            return PALETTE.exhausted;
        }
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

        const cx = w / 2.0;
        const cy = h / 2.0;
        const radius = (Math.min(w, h) - this._strokeWidth) / 2.0 - 1.0;

        if (radius <= 2.0) {
            cr.$dispose();
            return;
        }

        // 1. Draw Codenotch Ring Track (Translucent circle)
        cr.setLineWidth(this._strokeWidth);
        cr.setSourceRGBA(
            PALETTE.ringTrack.r,
            PALETTE.ringTrack.g,
            PALETTE.ringTrack.b,
            PALETTE.ringTrack.a
        );
        cr.arc(cx, cy, radius, 0, Math.PI * 2);
        cr.stroke();

        // 2. Draw Active Usage Arc (Starts at 12 o'clock, sweeps clockwise)
        const fraction = this._value / 100.0;
        if (fraction > 0.01) {
            const startAngle = -Math.PI / 2.0; // 12 o'clock
            const endAngle = startAngle + (fraction * Math.PI * 2.0);

            const activeColor = this._getBandColor(fraction);
            cr.setSourceRGBA(activeColor.r, activeColor.g, activeColor.b, activeColor.a);
            cr.setLineWidth(this._strokeWidth);
            cr.setLineCap(cairo.LineCap.ROUND);

            cr.arc(cx, cy, radius, startAngle, endAngle);
            cr.stroke();
        }

        // 3. Draw Inner Glyphs (Vector centered inside the ring)
        this._drawGlyph(cr, cx, cy, radius);

        // Crucial: dispose Cairo context to prevent GJS memory leaks
        cr.$dispose();
    }

    _drawGlyph(cr, cx, cy, radius) {
        cr.save();
        cr.translate(cx, cy);

        const activeColor = this._getBandColor(this._value / 100.0);
        const glyphAlpha = this._value > 0 ? 0.95 : 0.65;

        // Subtle tint matching the band when load is critical/high
        if (this._value >= 75.0) {
            cr.setSourceRGBA(activeColor.r, activeColor.g, activeColor.b, glyphAlpha);
        } else {
            cr.setSourceRGBA(PALETTE.glyphIdle.r, PALETTE.glyphIdle.g, PALETTE.glyphIdle.b, glyphAlpha);
        }

        if (this._type === 'cpu') {
            this._drawCpuGlyph(cr);
        } else if (this._type === 'ram') {
            this._drawRamGlyph(cr);
        } else if (this._type === 'fan') {
            this._drawFanGlyph(cr);
        }

        cr.restore();
    }

    _drawCpuGlyph(cr) {
        // Microprocessor chip with pins
        const chipSize = 7.0;
        const half = chipSize / 2.0;

        // Chip main square
        cr.setLineWidth(1.1);
        cr.rectangle(-half, -half, chipSize, chipSize);
        cr.stroke();

        // Central core dot
        cr.arc(0, 0, 1.2, 0, Math.PI * 2);
        cr.fill();

        // Outer pins
        const pinLen = 2.0;
        const pinOffset = 2.0;

        // Top pins
        cr.moveTo(-pinOffset, -half);
        cr.lineTo(-pinOffset, -half - pinLen);
        cr.moveTo(pinOffset, -half);
        cr.lineTo(pinOffset, -half - pinLen);

        // Bottom pins
        cr.moveTo(-pinOffset, half);
        cr.lineTo(-pinOffset, half + pinLen);
        cr.moveTo(pinOffset, half);
        cr.lineTo(pinOffset, half + pinLen);

        // Left pins
        cr.moveTo(-half, -pinOffset);
        cr.lineTo(-half - pinLen, -pinOffset);
        cr.moveTo(-half, pinOffset);
        cr.lineTo(-half - pinLen, pinOffset);

        // Right pins
        cr.moveTo(half, -pinOffset);
        cr.lineTo(half + pinLen, -pinOffset);
        cr.moveTo(half, pinOffset);
        cr.lineTo(half + pinLen, pinOffset);

        cr.stroke();
    }

    _drawRamGlyph(cr) {
        // Memory stick / DIMM module with contact pins
        const w = 10.0;
        const h = 6.0;
        const halfW = w / 2.0;
        const halfH = h / 2.0;

        cr.setLineWidth(1.1);

        // Main PCB outline
        cr.rectangle(-halfW, -halfH, w, h);
        cr.stroke();

        // Small internal memory block chips
        const chipW = 2.2;
        const chipH = 3.0;
        cr.rectangle(-halfW + 1.2, -halfH + 1.2, chipW, chipH);
        cr.rectangle(-chipW / 2.0, -halfH + 1.2, chipW, chipH);
        cr.rectangle(halfW - 1.2 - chipW, -halfH + 1.2, chipW, chipH);
        cr.fill();

        // Bottom contact notch / pin line
        cr.moveTo(-halfW + 1.0, halfH + 1.4);
        cr.lineTo(-1.0, halfH + 1.4);
        cr.moveTo(1.0, halfH + 1.4);
        cr.lineTo(halfW - 1.0, halfH + 1.4);
        cr.stroke();
    }

    _drawFanGlyph(cr) {
        // Rotatable 4-blade cooling fan propeller
        cr.rotate(this._fanAngle);

        // Center hub
        cr.arc(0, 0, 1.8, 0, Math.PI * 2);
        cr.fill();

        // 4 aerodynamic curved blades
        const bladeRadius = 5.2;
        cr.setLineWidth(1.2);
        cr.setLineCap(cairo.LineCap.ROUND);

        for (let i = 0; i < 4; i++) {
            const angle = (i * Math.PI) / 2.0;
            const x1 = Math.cos(angle) * 1.8;
            const y1 = Math.sin(angle) * 1.8;
            const x2 = Math.cos(angle + 0.35) * bladeRadius;
            const y2 = Math.sin(angle + 0.35) * bladeRadius;

            cr.moveTo(x1, y1);
            cr.curveTo(
                x1 + Math.cos(angle + 0.6) * 2.5,
                y1 + Math.sin(angle + 0.6) * 2.5,
                x2 - Math.cos(angle) * 1.5,
                y2 - Math.sin(angle) * 1.5,
                x2,
                y2
            );
            cr.stroke();
        }
    }
});
