import St from "gi://St";
import Clutter from "gi://Clutter";
import { MetricCard } from "./metric-card.js";

export function createMemoryWidget() {
  const card = new MetricCard({ id: "ram", title: "Memory" });

  return {
    id: "ram",
    title: "Memory",
    card,
    update(data) {
      if (typeof data.ram !== "number") return;
      const usedGb =
        data.ram_used_gb !== undefined ? data.ram_used_gb.toFixed(1) : "?";
      const totalGb =
        data.ram_total_gb !== undefined ? data.ram_total_gb.toFixed(1) : "?";
      card.setValue(`${usedGb} / ${totalGb} GB`);
      card.setSubtitle(`${data.ram.toFixed(1)}%`);
      card.setProgress(data.ram / 100.0);
    },
  };
}
