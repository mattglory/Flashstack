/**
 * FlashStack Dashboard — http://localhost:3000
 * Run: node scripts/dashboard.mjs
 */

import { createServer } from "http";
import { readFileSync }  from "fs";
import { execSync }      from "child_process";
import { ethers }        from "ethers";

const PORT     = 3000;
const ETH_LOG  = "/Users/mattglory/.pm2/logs/aave-eth-out.log";
const ARB_LOG  = "/Users/mattglory/.pm2/logs/aave-arb-out.log";
const WALLET   = "0x7Dff50b9F4f60dB5042bc01a26f39fB1266486d6";
const ETH_RPC  = process.env.ETH_RPC ?? "https://ethereum.publicnode.com";
const ARB_RPC  = process.env.ARB_RPC ?? "https://arb1.arbitrum.io/rpc";

// ── Parse log file ────────────────────────────────────────────────────────────
function parseLog(file) {
  let raw = "";
  try { raw = readFileSync(file, "utf8"); } catch { return null; }
  const lines = raw.split("\n").filter(Boolean);

  // Last summary line
  const summaryLine = [...lines].reverse().find(l => l.includes("Summary:"));
  let summary = { checked: 0, liquidatable: 0, atRisk: 0 };
  if (summaryLine) {
    const m = summaryLine.match(/(\d+) checked \| (\d+) liquidatable \| (\d+) at risk/);
    if (m) summary = { checked: +m[1], liquidatable: +m[2], atRisk: +m[3] };
  }

  // ETH price + gas
  const priceLine = [...lines].reverse().find(l => l.includes("ETH price:"));
  let ethPrice = "—", gas = "—";
  if (priceLine) {
    const mp = priceLine.match(/ETH price: \$([0-9,.]+)/);
    const mg = priceLine.match(/Gas: ~\$([0-9.]+)/);
    if (mp) ethPrice = "$" + mp[1];
    if (mg) gas = "$" + mg[1];
  }

  // Last scan time
  const timeLine = [...lines].reverse().find(l => l.includes("Scanning Aave V3"));
  let lastScan = "—";
  if (timeLine) {
    const m = timeLine.match(/\[(.+?)\]/);
    if (m) lastScan = new Date(m[1]).toLocaleTimeString();
  }

  // AT RISK positions (last scan only — between last two "Scanning" markers)
  const scanIdx = [];
  lines.forEach((l, i) => { if (l.includes("Scanning Aave V3")) scanIdx.push(i); });
  const sliceStart = scanIdx.length >= 2 ? scanIdx[scanIdx.length - 2] : 0;
  const recentLines = lines.slice(sliceStart);

  const atRiskPositions = [];
  recentLines.forEach(l => {
    const m = l.match(/\[AT RISK\] (0x[a-fA-F0-9]+\.\.\.) HF=([0-9.]+) debt=\$([0-9,]+)/);
    if (m) {
      const debt = parseInt(m[3].replace(/,/g, ""));
      if (debt >= 10000) atRiskPositions.push({ addr: m[1], hf: parseFloat(m[2]), debt });
    }
  });
  atRiskPositions.sort((a, b) => a.hf - b.hf);

  // Recent executions
  const executions = [];
  lines.forEach((l, i) => {
    if (l.includes("*** EXECUTING LIQUIDATION ***")) {
      const block = lines.slice(i, i + 15);
      const borrower  = block.find(x => x.includes("Borrower:"))?.match(/0x[a-fA-F0-9]+/)?.[0] ?? "—";
      const profit    = block.find(x => x.includes("Net profit"))?.match(/\$([0-9,.]+)/)?.[1] ?? "—";
      const status    = block.find(x => x.includes("✓ SUCCESS") || x.includes("✗ FAILED")) ?? "";
      const success   = status.includes("SUCCESS");
      executions.push({ borrower, profit, success });
    }
  });

  return { summary, ethPrice, gas, lastScan, atRiskPositions: atRiskPositions.slice(0, 15), executions: executions.slice(-5) };
}

// ── Get wallet balance ────────────────────────────────────────────────────────
async function getWalletBalance() {
  try {
    const provider = new ethers.JsonRpcProvider(ETH_RPC);
    const bal = await provider.getBalance(WALLET);
    return parseFloat(ethers.formatEther(bal)).toFixed(4);
  } catch { return "—"; }
}

// ── Get pm2 status ────────────────────────────────────────────────────────────
function getPm2Status() {
  try {
    const out = execSync("/opt/homebrew/bin/pm2 jlist 2>/dev/null", { encoding: "utf8" });
    const apps = JSON.parse(out);
    return apps.map(a => ({ name: a.name, status: a.pm2_env.status, uptime: a.pm2_env.pm_uptime }));
  } catch { return []; }
}

// ── HTML ──────────────────────────────────────────────────────────────────────
function html(ethData, arbData, walletBal, pm2) {
  const statusDot = s => s === "online"
    ? `<span style="color:#00ff88">● LIVE</span>`
    : `<span style="color:#ff4444">● ${s}</span>`;

  const hfColor = hf => hf < 1.01 ? "#ff4444" : hf < 1.03 ? "#ff8800" : hf < 1.05 ? "#ffcc00" : "#aaa";

  const riskRows = (positions, chain) => positions.map(p => `
    <tr>
      <td style="font-family:monospace;color:#88ccff">${p.addr}</td>
      <td style="color:${hfColor(p.hf)};font-weight:bold">${p.hf.toFixed(4)}</td>
      <td style="color:#fff">$${p.debt.toLocaleString()}</td>
      <td style="color:#aaa">~$${Math.round(p.debt * 0.5 * 0.05).toLocaleString()} profit</td>
    </tr>`).join("") || `<tr><td colspan="4" style="color:#555">No large AT RISK positions</td></tr>`;

  const execRows = execs => execs.length === 0
    ? `<tr><td colspan="3" style="color:#555">No executions yet — waiting for opportunity</td></tr>`
    : execs.map(e => `
      <tr>
        <td style="font-family:monospace;color:#88ccff">${e.borrower}</td>
        <td style="color:#00ff88">~$${e.profit}</td>
        <td style="color:${e.success ? "#00ff88" : "#ff4444"}">${e.success ? "✓ SUCCESS" : "✗ FAILED"}</td>
      </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <title>FlashStack Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0f; color: #ccc; font-family: -apple-system, sans-serif; padding: 24px; }
    h1 { color: #fff; font-size: 22px; margin-bottom: 4px; }
    .subtitle { color: #555; font-size: 13px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #12121a; border: 1px solid #222; border-radius: 10px; padding: 16px; }
    .card-label { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .card-value { font-size: 26px; font-weight: bold; color: #fff; }
    .card-sub { font-size: 12px; color: #555; margin-top: 4px; }
    .section { background: #12121a; border: 1px solid #222; border-radius: 10px; padding: 20px; margin-bottom: 20px; }
    .section h2 { font-size: 14px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: #555; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; padding: 0 0 10px 0; }
    td { padding: 8px 0; border-top: 1px solid #1a1a22; }
    .bot-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-top: 1px solid #1a1a22; }
    .bot-row:first-child { border-top: none; }
    .bot-name { font-weight: bold; color: #fff; }
    .refresh { font-size: 11px; color: #333; text-align: right; margin-top: 16px; }
    .profit-banner { background: linear-gradient(135deg, #0d2b1a, #0a1a0d); border: 1px solid #1a4a2a; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; color: #00ff88; font-size: 13px; }
  </style>
</head>
<body>
  <h1>⚡ FlashStack Dashboard</h1>
  <p class="subtitle">Auto-refreshes every 30s &nbsp;|&nbsp; Wallet: ${WALLET.slice(0,6)}...${WALLET.slice(-4)}</p>

  <div class="grid">
    <div class="card">
      <div class="card-label">ETH Price</div>
      <div class="card-value" style="color:#88ccff">${ethData?.ethPrice ?? "—"}</div>
      <div class="card-sub">Ethereum Mainnet</div>
    </div>
    <div class="card">
      <div class="card-label">Wallet Balance</div>
      <div class="card-value" style="color:#00ff88">${walletBal} ETH</div>
      <div class="card-sub">For gas fees</div>
    </div>
    <div class="card">
      <div class="card-label">Borrowers Watched</div>
      <div class="card-value">${((ethData?.summary.checked ?? 0) + (arbData?.summary.checked ?? 0)).toLocaleString()}</div>
      <div class="card-sub">Ethereum + Arbitrum</div>
    </div>
    <div class="card">
      <div class="card-label">AT RISK Positions</div>
      <div class="card-value" style="color:#ffcc00">${(ethData?.summary.atRisk ?? 0) + (arbData?.summary.atRisk ?? 0)}</div>
      <div class="card-sub">HF between 1.0 – 1.1</div>
    </div>
  </div>

  <div class="section">
    <h2>Bot Status</h2>
    ${pm2.map(b => `
      <div class="bot-row">
        <span class="bot-name">${b.name}</span>
        <span>${statusDot(b.status)}</span>
      </div>`).join("")}
  </div>

  <div class="section">
    <h2>🔥 Ethereum — Top AT RISK Positions (closest to liquidation)</h2>
    <table>
      <thead><tr><th>Address</th><th>Health Factor</th><th>Debt</th><th>Est. Profit</th></tr></thead>
      <tbody>${riskRows(ethData?.atRiskPositions ?? [], "eth")}</tbody>
    </table>
    <div class="card-sub" style="margin-top:12px">Last scan: ${ethData?.lastScan ?? "—"} &nbsp;|&nbsp; Gas: ${ethData?.gas ?? "—"}</div>
  </div>

  <div class="section">
    <h2>⚡ Arbitrum — Top AT RISK Positions</h2>
    <table>
      <thead><tr><th>Address</th><th>Health Factor</th><th>Debt</th><th>Est. Profit</th></tr></thead>
      <tbody>${riskRows(arbData?.atRiskPositions ?? [], "arb")}</tbody>
    </table>
    <div class="card-sub" style="margin-top:12px">Last scan: ${arbData?.lastScan ?? "—"} &nbsp;|&nbsp; Gas: ${arbData?.gas ?? "—"}</div>
  </div>

  <div class="section">
    <h2>💰 Recent Liquidation Executions</h2>
    <table>
      <thead><tr><th>Borrower</th><th>Net Profit</th><th>Result</th></tr></thead>
      <tbody>${execRows([...(ethData?.executions ?? []), ...(arbData?.executions ?? [])])}</tbody>
    </table>
  </div>

  <p class="refresh">Last updated: ${new Date().toLocaleString()} &nbsp;|&nbsp; Next refresh in 30s</p>
</body>
</html>`;
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  if (req.url !== "/") { res.writeHead(404); res.end(); return; }

  const [ethData, arbData, walletBal, pm2] = await Promise.all([
    Promise.resolve(parseLog(ETH_LOG)),
    Promise.resolve(parseLog(ARB_LOG)),
    getWalletBalance(),
    Promise.resolve(getPm2Status()),
  ]);

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html(ethData, arbData, walletBal, pm2));
});

server.listen(PORT, () => {
  console.log(`\n FlashStack Dashboard running at http://localhost:${PORT}`);
  console.log(` Auto-refreshes every 30 seconds`);
  console.log(` Press Ctrl+C to stop\n`);
});
