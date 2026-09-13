import St from "gi://St";
import Clutter from "gi://Clutter";

/**
 * A reusable horizontal metric card for the Liquid Glass popover.
 * Each card has: title, main value, optional subtitle, optional sparkline,
 * optional progress bar, optional graph area.
 */
export class MetricCard {
  constructor({ id, title, width, height, xExpand = true }) {
    this._id = id;
    this._visible = true;

    this._outerWrap = new St.BoxLayout({
      style_class: "codenotch-glass-card",
      vertical: true,
      x_expand: xExpand,
      y_expand: false,
      x_align: Clutter.ActorAlign.FILL,
    });

    // Header row: title + value
    this._headerRow = new St.BoxLayout({
      style_class: "codenotch-card-header-row",
      x_expand: true,
    });

    this._titleLbl = new St.Label({
      text: title,
      style_class: "codenotch-card-title",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._valueLbl = new St.Label({
      text: "--",
      style_class: "codenotch-card-value",
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._headerRow.add_child(this._titleLbl);
    this._headerRow.add_child(this._valueLbl);

    // Subtitle row
    this._subtitleLbl = new St.Label({
      text: "",
      style_class: "codenotch-card-subtitle",
      visible: false,
    });

    // Progress bar track
    this._progressTrack = new St.BoxLayout({
      style_class: "codenotch-glass-progress-track",
      x_expand: true,
    });
    this._progressFill = new St.Widget({
      style_class: "codenotch-glass-progress-fill codenotch-fill-ample",
      width: 0,
    });
    this._progressTrack.add_child(this._progressFill);

    // Graph container (for sparklines)
    this._graphWrap = new St.BoxLayout({
      style_class: "codenotch-card-graph-wrap",
      x_expand: true,
      visible: false,
    });

    this._outerWrap.add_child(this._headerRow);
    this._outerWrap.add_child(this._subtitleLbl);
    this._outerWrap.add_child(this._progressTrack);
    this._outerWrap.add_child(this._graphWrap);
  }

  get actor() {
    return this._outerWrap;
  }

  get id() {
    return this._id;
  }

  get title() {
    return this._titleLbl;
  }

  get value() {
    return this._valueLbl;
  }

  get subtitle() {
    return this._subtitleLbl;
  }

  get progressTrack() {
    return this._progressTrack;
  }

  get graphWrap() {
    return this._graphWrap;
  }

  setValue(text) {
    this._valueLbl.text = text;
  }

  setSubtitle(text) {
    if (text) {
      this._subtitleLbl.text = text;
      this._subtitleLbl.visible = true;
    } else {
      this._subtitleLbl.visible = false;
    }
  }

  setProgress(fraction) {
    const frac = Math.max(0, Math.min(1, fraction));
    const totalW =
      this._progressTrack.allocation.get_width() > 0
        ? this._progressTrack.allocation.get_width()
        : 180;
    const fillW = Math.max(0, Math.round(frac * totalW));
    if (this._progressFill.width !== fillW) this._progressFill.width = fillW;
    this._applyBandColor(this._progressFill, frac);
  }

  addGraph(sparkline) {
    this._graphWrap.add_child(sparkline);
    this._graphWrap.visible = true;
  }

  addGraphPair(sparkA, sparkB) {
    const pairWrap = new St.BoxLayout({
      style_class: "codenotch-card-graph-pair",
      x_expand: true,
    });
    pairWrap.add_child(sparkA);
    pairWrap.add_child(sparkB);
    this._graphWrap.add_child(pairWrap);
    this._graphWrap.visible = true;
  }

  addExtraRow(widget) {
    this._outerWrap.add_child(widget);
  }

  setVisible(visible) {
    this._visible = visible;
    this._outerWrap.visible = visible;
  }

  get isVisible() {
    return this._visible;
  }

  _applyBandColor(widget, fraction) {
    let cls;
    if (fraction < 0.5) cls = "codenotch-fill-ample";
    else if (fraction < 0.75) cls = "codenotch-fill-watch";
    else if (fraction < 0.9) cls = "codenotch-fill-critical";
    else cls = "codenotch-fill-exhausted";

    if (widget._lastBandClass === cls) return;
    if (widget._lastBandClass) widget.remove_style_class_name(widget._lastBandClass);
    widget.add_style_class_name(cls);
    widget._lastBandClass = cls;
  }
}
