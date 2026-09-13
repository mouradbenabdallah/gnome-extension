import St from "gi://St";
import Clutter from "gi://Clutter";
import { MetricCard } from "./metric-card.js";
import { Sparkline } from "../sparkline.js";

export function createGpuWidget() {
  const card = new MetricCard({ id: "gpu", title: "GPU" });
  card.setSubtitle("Detecting\u2026");

  const spark = new Sparkline({ color: "#58C48F", width: 170, height: 20 });
  card.addGraph(spark);

  return {
    id: "gpu",
    title: "GPU",
    card,
    spark,
    update(data) {
      const gpuUtil =
        typeof data.gpu_util === "number" && data.gpu_util !== null
          ? data.gpu_util
          : 0;
      const temp =
        typeof data.gpu_temp === "number" && data.gpu_temp !== null
          ? `${data.gpu_temp}\u00B0C`
          : "--\u00B0C";
      if (data.gpu_name) {
        card.title.text = data.gpu_name;
      }
      const actionable = typeof data.gpu_util === "number";
      card.setValue(`${gpuUtil}%`);
      card.setSubtitle(
        actionable ? `${temp}` : `Standby / Sleep  \u00B7  ${temp}`,
      );
      card.setProgress(gpuUtil / 100.0);
      spark.pushValue(gpuUtil);
    },
  };
}
