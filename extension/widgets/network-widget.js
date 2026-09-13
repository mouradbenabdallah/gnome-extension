import { MetricCard } from "./metric-card.js";
import { Sparkline } from "../sparkline.js";

export function createNetworkWidget() {
  const card = new MetricCard({ id: "network", title: "Network" });

  const rxSpark = new Sparkline({ color: "#4FC3E8", width: 80, height: 20 });
  const txSpark = new Sparkline({ color: "#D98CB0", width: 80, height: 20 });
  card.addGraphPair(rxSpark, txSpark);

  function fmtRate(kbs) {
    if (kbs >= 1024) return `${(kbs / 1024.0).toFixed(1)} MB/s`;
    return `${Math.round(kbs)} KB/s`;
  }

  return {
    id: "network",
    title: "Network",
    card,
    rxSpark,
    txSpark,
    update(data) {
      const rx = typeof data.net_rx_kbs === "number" ? data.net_rx_kbs : 0;
      const tx = typeof data.net_tx_kbs === "number" ? data.net_tx_kbs : 0;
      card.setValue(`\u2193 ${fmtRate(rx)}`);
      card.setSubtitle(`\u2191 ${fmtRate(tx)}`);
      rxSpark.pushValue(rx);
      txSpark.pushValue(tx);
    },
  };
}
