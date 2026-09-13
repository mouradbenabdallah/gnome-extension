import St from "gi://St";
import Clutter from "gi://Clutter";
import { MetricCard } from "./metric-card.js";

export function createProcessesWidget() {
  const card = new MetricCard({
    id: "processes",
    title: "Top Processes",
    xExpand: false,
  });

  const procList = new St.BoxLayout({
    vertical: true,
    style_class: "codenotch-proc-list",
  });
  card.addExtraRow(procList);

  const procRows = [];

  function syncProcRows(parent, rows, dataList) {
    while (rows.length < dataList.length) {
      const rowBox = new St.BoxLayout({
        style_class: "codenotch-card-row codenotch-proc-row",
        x_expand: true,
      });
      const nameLbl = new St.Label({
        style_class: "codenotch-card-subtitle",
        x_expand: true,
      });
      const valLbl = new St.Label({
        style_class: "codenotch-card-val codenotch-proc-pct",
      });
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
    id: "processes",
    title: "Top Processes",
    card,
    update(data) {
      const procData = Array.isArray(data.top)
        ? data.top.map((p) => [
            p.name || `PID ${p.pid || "?"}`,
            p.cpu >= 100 ? ">99%" : `${Math.round(p.cpu)}%`,
          ])
        : [];
      syncProcRows(procList, procRows, procData);
    },
  };
}
