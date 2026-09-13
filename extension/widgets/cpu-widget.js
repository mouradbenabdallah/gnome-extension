import St from "gi://St";
import Clutter from "gi://Clutter";
import { MetricCard } from "./metric-card.js";
import { Sparkline } from "../sparkline.js";

export function createCpuWidget() {
  const card = new MetricCard({ id: "cpu", title: "CPU" });

  const spark = new Sparkline({ color: "#5bc0ff", width: 170, height: 20 });
  card.addGraph(spark);

  return {
    id: "cpu",
    title: "CPU",
    card,
    spark,
    update(data, settings) {
      if (typeof data.cpu !== "number") return;
      const showTemp =
        settings && settings.get_boolean
          ? settings.get_boolean("show-cpu-temp")
          : true;
      let text = `${data.cpu.toFixed(1)}%`;
      if (showTemp && typeof data.cpu_temp === "number") {
        text += `  ·  ${data.cpu_temp}\u00B0C`;
      }
      card.setValue(text);
      card.setProgress(data.cpu / 100.0);
      spark.pushValue(data.cpu);
    },
  };
}
