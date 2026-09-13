import St from "gi://St";
import Clutter from "gi://Clutter";

/**
 * Central registry of all metric widgets. Each widget declares its id, title,
 * panel visibility, and renders into a horizontal metric card for the popover.
 */
export class WidgetRegistry {
  constructor(settings) {
    this._settings = settings;
    this._widgets = new Map();
    this._order = [];
  }

  register(def) {
    this._widgets.set(def.id, def);
  }

  get(id) {
    return this._widgets.get(id);
  }

  all() {
    return this._order.map((id) => this._widgets.get(id)).filter(Boolean);
  }

  enabled() {
    return this.all().filter((w) => this.isEnabled(w.id));
  }

  isEnabled(id) {
    const key = `show-${id}`;
    return this._settings ? this._settings.get_boolean(key) : true;
  }

  /** Returns ordered array of widget ids from GSettings or default order. */
  loadOrder() {
    const defaultOrder = [
      "cpu",
      "ram",
      "gpu",
      "network",
      "fan",
      "disk",
      "history",
      "processes",
    ];

    if (this._settings) {
      const stored = this._settings.get_string("widget-order");
      if (stored) {
        const parsed = stored.split(",").filter(Boolean);
        const valid = parsed.filter((id) => this._widgets.has(id));
        const missing = defaultOrder.filter(
          (id) => this._widgets.has(id) && !valid.includes(id),
        );
        this._order = [...valid, ...missing];
        return this._order;
      }
    }
    this._order = defaultOrder.filter((id) => this._widgets.has(id));
    return this._order;
  }

  saveOrder() {
    if (this._settings) {
      this._settings.set_string("widget-order", this._order.join(","));
    }
  }

  moveWidget(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this._order.length) return;
    if (toIdx < 0 || toIdx >= this._order.length) return;
    const [id] = this._order.splice(fromIdx, 1);
    this._order.splice(toIdx, 0, id);
    this.saveOrder();
  }
}
