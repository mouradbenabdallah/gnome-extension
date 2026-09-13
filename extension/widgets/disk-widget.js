import { MetricCard } from "./metric-card.js";
import { Sparkline } from "../sparkline.js";

export function createDiskWidget() {
  const card = new MetricCard({ id: "disk", title: "Disk I/O" });

  const readSpark = new Sparkline({ color: "#00ff88", width: 80, height: 20 });
  const writeSpark = new Sparkline({
    color: "#ffb000",
    width: 80,
    height: 20,
  });
  card.addGraphPair(readSpark, writeSpark);

  function fmtRate(kbs) {
    if (kbs >= 1024) return `${(kbs / 1024.0).toFixed(1)} MB/s`;
    return `${Math.round(kbs)} KB/s`;
  }

  return {
    id: "disk",
    title: "Disk I/O",
    card,
    readSpark,
    writeSpark,
    update(data) {
      const rd = typeof data.disk_read_kbs === "number" ? data.disk_read_kbs : 0;
      const wr =
        typeof data.disk_write_kbs === "number" ? data.disk_write_kbs : 0;
      card.setValue(`R ${fmtRate(rd)}  \u00B7  W ${fmtRate(wr)}`);
      readSpark.pushValue(rd);
      writeSpark.pushValue(wr);
    },
  };
}
