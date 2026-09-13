import St from "gi://St";
import Clutter from "gi://Clutter";
import { MetricCard } from "./metric-card.js";

export function createFanWidget() {
  const card = new MetricCard({ id: "fan", title: "Cooling Fans" });
  card.setSubtitle("Detecting\u2026");

  const subList = new St.BoxLayout({
    vertical: true,
    style_class: "codenotch-fansublist",
  });
  card.addExtraRow(subList);

  const fanRows = [];

  function syncFanRows(parent, rows, dataList) {
    const valStyle = "codenotch-card-val";
    while (rows.length < dataList.length) {
      const rowBox = new St.BoxLayout({
        style_class: "codenotch-card-row codenotch-fan-detail-row",
        x_expand: true,
      });
      const nameLbl = new St.Label({
        style_class: "codenotch-card-subtitle",
        x_expand: true,
      });
      const valLbl = new St.Label({ style_class: valStyle });
      rowBox.add_child(nameLbl);
      rowBox.add_child(valLbl);
      parent.add_child(rowBox);
      rows.push({ row: rowBox, nameLbl, valLbl });
    }
    dataList.forEach(([name, value], i) => {
      rows[i].nameLbl.text = name;
      rows[i].valLbl.text = value;
      rows[i].row.visible = true;
    });
    for (let i = dataList.length; i < rows.length; i++) {
      rows[i].row.visible = false;
    }
  }

  return {
    id: "fan",
    title: "Cooling Fans",
    card,
    update(data) {
      const fans = Array.isArray(data.fans) ? data.fans : [];
      if (fans.length > 0) {
        card.title.text =
          fans.length === 1 ? "Cooling Fan" : `Cooling Fans (${fans.length})`;
      }
      const fanPct = typeof data.fan_pct === "number" ? data.fan_pct : 0;
      const fanRpm = typeof data.fan_rpm === "number" ? data.fan_rpm : 0;

      if (fanRpm > 0) {
        card.setValue(`${fanRpm} RPM`);
        card.setSubtitle(`${fanPct}%`);
      } else {
        card.setValue(`${fanPct}%`);
        card.setSubtitle(fanPct > 0 ? "" : "Idle / Stopped");
      }
      card.setProgress(fanPct / 100.0);

      const fanData = fans.map((f) => [
        f.label || "Fan",
        f.rpm > 0 ? `${f.rpm} RPM  \u00B7  ${f.pct}%` : `${f.pct}%`,
      ]);
      syncFanRows(subList, fanRows, fanData);
    },
  };
}
