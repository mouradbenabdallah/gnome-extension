import { MetricCard } from "./metric-card.js";
import { Sparkline } from "../sparkline.js";

export function createHistoryWidget() {
  const card = new MetricCard({
    id: "history",
    title: "History (last 30 s)",
    xExpand: false,
  });

  const spark = new Sparkline({ color: "#5bc0ff", width: 170, height: 24 });
  card.addGraph(spark);

  return {
    id: "history",
    title: "History",
    card,
    spark,
    update(data) {
      if (typeof data.cpu !== "number") return;
      spark.pushValue(data.cpu);
    },
  };
}
