import { MetricCard } from "./metric-card.js";
import { Sparkline } from "../sparkline.js";

const HISTORY_POINTS = 30;

export function createHistoryWidget() {
  const card = new MetricCard({
    id: "history",
    title: "History (last 30 s)",
    xExpand: false,
  });

  const spark = new Sparkline({ color: "#5bc0ff", width: 170, height: 24 });
  card.addGraph(spark);

  const history = [];

  return {
    id: "history",
    title: "History",
    card,
    spark,
    history,
    update(data) {
      if (typeof data.cpu !== "number") return;
      history.push(data.cpu);
      while (history.length > HISTORY_POINTS) history.shift();
      spark.setData(history);
    },
  };
}
