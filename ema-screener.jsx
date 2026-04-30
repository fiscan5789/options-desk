import { useState, useRef, useCallback, useEffect } from "react";

const TICKERS = [
  "AAPL","MSFT","NVDA","GOOGL","GOOG","AMZN","META","TSLA","AVGO","ORCL",
  "ADBE","CRM","INTU","NOW","WDAY","SNOW","DDOG","NET","CRWD","ZS",
  "PANW","OKTA","FTNT","GTLB","MDB","CFLT","HUBS","SHOP","SQ","PYPL",
  "AFRM","BILL","DOCN","BRZE","RBLX","APP","SNAP","PINS","RDDT","BMBL",
  "AMD","INTC","QCOM","TXN","AMAT","LRCX","KLAC","ADI","MRVL","MCHP",
  "SMCI","ON","MPWR","ENTG","ACLS","ONTO","COHU","ICHR","MU","WDC",
  "STX","PSTG","NTAP","HPE","IBM","DELL","HPQ","SWKS","QRVO","AMBA",
  "JPM","BAC","WFC","C","GS","MS","BLK","SCHW","AXP","V","MA","COF",
  "DFS","SYF","ALLY","FITB","KEY","RF","HBAN","CFG","MTB","USB","PNC",
  "TFC","ZION","CMA","WAL","EWBC","SOFI","NU","HOOD","COIN","MSTR",
  "JNJ","UNH","LLY","ABBV","MRK","ABT","TMO","DHR","BMY","AMGN",
  "GILD","REGN","VRTX","BIIB","MRNA","BNTX","ZBH","BSX","EW","SYK",
  "MDT","ISRG","RMD","DXCM","PODD","INSP","NTRA","EXAS","ILMN","PACB",
  "WMT","COST","TGT","HD","LOW","MCD","SBUX","NKE","LULU","DECK",
  "ONON","CROX","SKX","PVH","RL","TPR","ROST","TJX","BURL","ULTA",
  "FIVE","DG","DLTR","ETSY","EBAY","W","CHWY","PDD","MTCH","IAC",
  "XOM","CVX","COP","SLB","EOG","DVN","MPC","VLO","PSX","HES",
  "OXY","APA","FANG","CTRA","AR","EQT","RRC","MTDR","SM","CIVI",
  "BA","LMT","RTX","NOC","GD","HON","GE","CAT","DE","EMR",
  "ETN","PH","ROK","AME","FAST","GWW","TDG","HWM","KTOS","AXON",
  "CACI","LDOS","BAH","SAIC","SPR","HEI","TDY","VRSK","MSC","GNRC",
  "NFLX","DIS","CMCSA","WBD","PARA","FOXA","SPOT","ROKU","TTD","MGNI",
  "T","VZ","TMUS","LUMN","LYV","WWE","IMAX","CNK","EDR","SIRI",
  "RIVN","LCID","F","GM","STLA","UBER","LYFT","DASH","ABNB","BKNG",
  "EXPE","OPEN","RDFN","ZG","HIMS","CART","GRAB","BLNK","CHPT","GOEV",
  "UPST","LC","OPFI","TREE","PLTR","IONQ","RGTI","QBTS","ARQQ","QUBT",
  "PG","KO","PEP","PM","MO","MDLZ","GIS","K","CPB","HSY",
  "NEE","DUK","SO","AEP","EXC","XEL","ES","WEC","ETR","PPL",
  "ACMR","ONTO","FORM","WOLF","SLAB","RELY","FLYW","PAYO","PSFE","BTBT",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build Polygon EMA URL
function polygonUrl(ticker, period, apiKey) {
  return (
    `https://api.polygon.io/v1/indicators/ema/${encodeURIComponent(ticker)}` +
    `?timespan=day&adjusted=true&window=${period}&series_type=close&order=desc&limit=1&apiKey=${apiKey}`
  );
}

// Try direct fetch; if network-blocked, fall back to corsproxy.io
async function fetchWithFallback(url) {
  // 1. Try direct
  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const data = await res.json();
    return { data, via: "direct", status: res.status };
  } catch (directErr) {
    // 2. Fall back to corsproxy.io
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { method: "GET", headers: { Accept: "application/json" } });
    const data = await res.json();
    return { data, via: "proxy", status: res.status };
  }
}

async function fetchOneEMA(ticker, period, apiKey) {
  const url = polygonUrl(ticker, period, apiKey);
  const { data, via, status } = await fetchWithFallback(url);
  if (data.status === "ERROR") throw new Error(`Polygon: ${data.error || "unknown error"}`);
  const val = data.results?.values?.[0]?.value;
  if (val === undefined || val === null) throw new Error(`No value in response (HTTP ${status}, via ${via})`);
  return { value: Number(val), via };
}

async function checkTicker(ticker, apiKey) {
  const [r8, r21, r34, r55, r89] = await Promise.all([
    fetchOneEMA(ticker, 8, apiKey),
    fetchOneEMA(ticker, 21, apiKey),
    fetchOneEMA(ticker, 34, apiKey),
    fetchOneEMA(ticker, 55, apiKey),
    fetchOneEMA(ticker, 89, apiKey),
  ]);
  const [e8, e21, e34, e55, e89] = [r8.value, r21.value, r34.value, r55.value, r89.value];
  const aligned = e8 > e21 && e21 > e34 && e34 > e55 && e55 > e89;
  return aligned ? { ticker, e8, e21, e34, e55, e89, via: r8.via } : null;
}

const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : "—");

export default function EMAScreener() {
  const [apiKey, setApiKey]     = useState("");
  const [running, setRunning]   = useState(false);
  const [testing, setTesting]   = useState(false);
  const [results, setResults]   = useState([]);
  const [log, setLog]           = useState([]);
  const [progress, setProgress] = useState({ checked: 0, total: TICKERS.length });
  const [done, setDone]         = useState(false);
  const abortRef = useRef(false);
  const logRef   = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const addLog = useCallback((msg, type = "info") => {
    setLog((prev) => [...prev.slice(-100), { msg, type, id: Date.now() + Math.random() }]);
  }, []);

  // ── Diagnostic test ─────────────────────────────────────────────────────────
  const testConnection = useCallback(async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    addLog("━━━ DIAGNOSTICS ━━━", "system");

    // Step 1: direct fetch
    addLog("1. Trying direct fetch to api.polygon.io…", "checking");
    const directUrl = polygonUrl("AAPL", 21, apiKey.trim());
    try {
      const res = await fetch(directUrl, { headers: { Accept: "application/json" } });
      const data = await res.json();
      if (data.status === "ERROR") {
        addLog(`   ✗ Polygon error: ${data.error}`, "error");
      } else {
        const val = data.results?.values?.[0]?.value;
        addLog(`   ✓ Direct OK — AAPL EMA(21) = ${Number(val).toFixed(4)}`, "hit");
        addLog("━━━ CONNECTION GOOD — ready to scan ━━━", "system");
        setTesting(false);
        return;
      }
    } catch (e) {
      addLog(`   ✗ Direct blocked: "${e.message}"`, "warn");
    }

    // Step 2: corsproxy.io fallback
    addLog("2. Trying corsproxy.io fallback…", "checking");
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(directUrl)}`;
    try {
      const res = await fetch(proxyUrl, { headers: { Accept: "application/json" } });
      const data = await res.json();
      if (data.status === "ERROR") {
        addLog(`   ✗ Polygon error via proxy: ${data.error}`, "error");
        addLog("   → Your API key may be invalid or lack access to indicator endpoints", "warn");
      } else {
        const val = data.results?.values?.[0]?.value;
        addLog(`   ✓ Proxy OK — AAPL EMA(21) = ${Number(val).toFixed(4)}`, "hit");
        addLog("━━━ CONNECTION GOOD (via proxy) — ready to scan ━━━", "system");
      }
    } catch (e) {
      addLog(`   ✗ Proxy also failed: "${e.message}"`, "error");
      addLog("━━━ BOTH METHODS FAILED ━━━", "error");
      addLog("→ Check your internet connection or try a different browser", "warn");
    }

    setTesting(false);
  }, [apiKey, addLog]);

  // ── Main scan ────────────────────────────────────────────────────────────────
  const runScreener = useCallback(async () => {
    if (!apiKey.trim()) return;
    abortRef.current = false;
    setRunning(true);
    setResults([]);
    setLog([]);
    setDone(false);
    setProgress({ checked: 0, total: TICKERS.length });

    addLog("◈ EMA Alignment Screener", "system");
    addLog("◈ EMA(8) > EMA(21) > EMA(34) > EMA(55) > EMA(89) · Daily", "system");
    addLog(`◈ ${TICKERS.length} symbols`, "system");

    const found = [];

    for (let i = 0; i < TICKERS.length; i++) {
      if (abortRef.current) { addLog("⊘ Aborted", "warn"); break; }
      if (found.length >= 5) break;

      const ticker = TICKERS[i];
      addLog(`→ ${ticker}`, "checking");

      try {
        const result = await checkTicker(ticker, apiKey.trim());
        if (result) {
          found.push(result);
          setResults([...found]);
          addLog(`✓ ${ticker} — ALIGNED  [${found.length}/5]`, "hit");
        } else {
          addLog(`✗ ${ticker}`, "miss");
        }
      } catch (err) {
        const msg = err.message || "unknown";
        if (msg.includes("403") || msg.includes("401") || msg.toLowerCase().includes("forbidden")) {
          addLog(`⊘ Auth error on ${ticker} — check your API key`, "error");
          break;
        }
        if (msg.includes("429")) {
          addLog(`⚠ Rate limited — pausing 15s`, "warn");
          await sleep(15000);
          i--;
          continue;
        }
        addLog(`! ${ticker} — ${msg.slice(0, 80)}`, "warn");
      }

      setProgress({ checked: i + 1, total: TICKERS.length });
      await sleep(300);
    }

    setDone(true);
    setRunning(false);
    addLog(
      found.length
        ? `◈ Done — ${found.length} aligned stock${found.length > 1 ? "s" : ""} found`
        : "◈ Scan complete — no aligned stocks found",
      "system"
    );
  }, [apiKey, addLog]);

  const stopScan = () => { abortRef.current = true; };
  const pct = progress.total > 0 ? (progress.checked / progress.total) * 100 : 0;
  const busy = running || testing;

  return (
    <div style={{
      minHeight: "100vh", background: "#060a10", color: "#c8d8e8",
      fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace",
      padding: "28px 20px", boxSizing: "border-box",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Barlow+Condensed:wght@500;700&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#0d1520}
        ::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:2px}
        @keyframes slideIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        .result-row{animation:slideIn 0.3s ease}
        .log-line{animation:fadeIn 0.12s ease}
        .btn-run:hover:not(:disabled){background:#00e07a!important;transform:translateY(-1px)}
        .btn-test:hover:not(:disabled){border-color:#00cc66!important;color:#00cc66!important}
        .btn-stop:hover{background:#cc2222!important}
        input:focus{outline:none;border-color:#00cc66!important;box-shadow:0 0 0 2px rgba(0,204,102,0.15)!important}
      `}</style>

      <div style={{ maxWidth: 920, margin: "0 auto 20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 4 }}>
          <span style={{
            fontFamily: "'Barlow Condensed',sans-serif",
            fontSize: 26, fontWeight: 700, letterSpacing: "0.08em",
            color: "#00ff88", textTransform: "uppercase",
          }}>EMA Alignment Screener</span>
          <span style={{ fontSize: 10, color: "#3a5a7a", letterSpacing: "0.12em" }}>POLYGON.IO</span>
        </div>
        <div style={{ fontSize: 10, color: "#2a5a4a", letterSpacing: "0.05em" }}>
          EMA(8) &gt; EMA(21) &gt; EMA(34) &gt; EMA(55) &gt; EMA(89) · DAILY CLOSE · {TICKERS.length} SYMBOLS
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>

        {/* Left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          <div style={{ background: "#0a1520", border: "1px solid #1a2f4a", borderRadius: 4, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "#3a6080", letterSpacing: "0.12em", marginBottom: 7 }}>POLYGON API KEY</div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your Polygon.io API key…"
              disabled={busy}
              style={{
                width: "100%", background: "#050d18", border: "1px solid #1a2f4a",
                borderRadius: 3, color: "#a0c8e8", fontFamily: "inherit",
                fontSize: 13, padding: "7px 10px",
                transition: "border-color 0.2s,box-shadow 0.2s",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-run" onClick={runScreener}
              disabled={busy || !apiKey.trim()}
              style={{
                flex: 1, background: running ? "#0a2a1a" : "#00cc66",
                color: running ? "#1a4a2a" : "#000", border: "none", borderRadius: 3,
                fontFamily: "inherit", fontWeight: 700, fontSize: 11,
                letterSpacing: "0.1em", padding: "10px 0",
                cursor: (busy || !apiKey.trim()) ? "not-allowed" : "pointer",
                transition: "all 0.15s", textTransform: "uppercase",
              }}
            >{running ? "◈ Scanning…" : "▶ Run Scan"}</button>

            <button className="btn-test" onClick={testConnection}
              disabled={busy || !apiKey.trim()}
              style={{
                background: "transparent", color: "#3a7a5a",
                border: "1px solid #1a3a2a", borderRadius: 3,
                fontFamily: "inherit", fontSize: 11, letterSpacing: "0.1em",
                padding: "10px 12px", whiteSpace: "nowrap",
                cursor: (busy || !apiKey.trim()) ? "not-allowed" : "pointer",
                transition: "all 0.15s", textTransform: "uppercase",
              }}
            >{testing ? "Testing…" : "Test API"}</button>

            {running && (
              <button className="btn-stop" onClick={stopScan}
                style={{
                  background: "#1a0808", color: "#ff6666",
                  border: "1px solid #3a1010", borderRadius: 3,
                  fontFamily: "inherit", fontSize: 11, letterSpacing: "0.1em",
                  padding: "10px 12px", cursor: "pointer",
                  transition: "all 0.15s", textTransform: "uppercase",
                }}
              >⊘ Stop</button>
            )}
          </div>

          {(running || done) && (
            <div style={{ background: "#0a1520", border: "1px solid #1a2f4a", borderRadius: 4, padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                <span style={{ fontSize: 10, color: "#3a6080", letterSpacing: "0.1em" }}>
                  {done ? "COMPLETE" : "SCANNING"}
                </span>
                <span style={{ fontSize: 10, color: running ? "#00ff88" : "#3a9a5a" }}>
                  {progress.checked} / {progress.total}
                </span>
              </div>
              <div style={{ background: "#050d18", borderRadius: 2, height: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: done ? "#00cc66" : "linear-gradient(90deg,#00cc66,#00ff88)",
                  borderRadius: 2, transition: "width 0.3s ease",
                  boxShadow: running ? "0 0 8px #00ff8866" : "none",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 10, color: "#2a4a6a" }}>
                <span>ALIGNED: {results.length}/5</span>
                <span>{pct.toFixed(0)}%</span>
              </div>
            </div>
          )}

          <div style={{
            background: "#070d18", border: "1px solid #1a2f4a",
            borderRadius: 4, overflow: "hidden", flexGrow: 1, minHeight: 220,
          }}>
            <div style={{
              padding: "7px 14px", borderBottom: "1px solid #1a2f4a",
              fontSize: 10, color: "#3a6080", letterSpacing: "0.1em", background: "#0a1520",
            }}>SCAN LOG</div>
            <div ref={logRef} style={{ maxHeight: 340, overflowY: "auto", padding: "10px 14px" }}>
              {log.length === 0 && (
                <div style={{ color: "#1e3a5a", fontSize: 11, fontStyle: "italic" }}>
                  Paste your API key and click "Test API" first to diagnose connectivity…
                </div>
              )}
              {log.map((entry) => (
                <div key={entry.id} className="log-line" style={{
                  fontSize: 11, lineHeight: 1.75,
                  color: entry.type === "hit"      ? "#00ff88"
                       : entry.type === "miss"     ? "#1e3a4a"
                       : entry.type === "system"   ? "#5a9aaa"
                       : entry.type === "error"    ? "#ff5555"
                       : entry.type === "warn"     ? "#ffaa44"
                       : entry.type === "checking" ? "#3a6a8a"
                       : "#3a6080",
                }}>{entry.msg}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Right */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 10, color: "#3a6080", letterSpacing: "0.12em", padding: "0 2px" }}>
            ALIGNED RESULTS ({results.length} / 5)
          </div>

          {results.length === 0 && (
            <div style={{
              flex: 1, background: "#0a1520", border: "1px dashed #1a2f4a",
              borderRadius: 4, display: "flex", alignItems: "center",
              justifyContent: "center", minHeight: 280,
            }}>
              <div style={{ textAlign: "center", color: "#1e3550" }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>◉</div>
                <div style={{ fontSize: 11, letterSpacing: "0.1em" }}>AWAITING SCAN</div>
              </div>
            </div>
          )}

          {results.map((r, i) => (
            <div key={r.ticker} className="result-row" style={{
              background: "linear-gradient(135deg,#0a1f14,#0a1520)",
              border: "1px solid #1a4a2a", borderLeft: "3px solid #00cc66",
              borderRadius: 4, padding: "12px 14px",
              boxShadow: "0 0 16px rgba(0,204,102,0.04)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{
                    fontFamily: "'Barlow Condensed',sans-serif",
                    fontSize: 20, fontWeight: 700, color: "#00ff88", letterSpacing: "0.05em",
                  }}>{r.ticker}</span>
                  <span style={{ fontSize: 9, color: "#2a6040", letterSpacing: "0.08em" }}>BULL TREND</span>
                </div>
                <span style={{ fontSize: 10, color: "#1e4030" }}>#{i + 1}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 5 }}>
                {[["EMA 8",r.e8],["EMA 21",r.e21],["EMA 34",r.e34],["EMA 55",r.e55],["EMA 89",r.e89]].map(([label,val]) => (
                  <div key={label} style={{
                    background: "#060f0a", border: "1px solid #0e2a18",
                    borderRadius: 3, padding: "5px 6px", textAlign: "center",
                  }}>
                    <div style={{ fontSize: 9, color: "#2a5a3a", letterSpacing: "0.06em", marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 10, color: "#88ddaa", fontWeight: 600 }}>{fmt(val)}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 8, display: "flex", alignItems: "flex-end", gap: 3, height: 36 }}>
                {[r.e8,r.e21,r.e34,r.e55,r.e89].map((val, idx, arr) => {
                  const minV = Math.min(...arr);
                  const range = Math.max(...arr) - minV || 1;
                  const h = 10 + ((val - minV) / range) * 26;
                  return (
                    <div key={idx} style={{
                      flex: 1, height: `${h}px`,
                      background: `rgba(0,204,102,${0.9 - idx * 0.14})`,
                      borderRadius: "2px 2px 0 0",
                    }} />
                  );
                })}
              </div>
            </div>
          ))}

          {done && results.length === 5 && (
            <div style={{
              background: "#0a1f14", border: "1px solid #1a4a2a", borderRadius: 4,
              padding: "9px 14px", fontSize: 11, color: "#3a9a5a",
              letterSpacing: "0.06em", textAlign: "center",
            }}>✓ TARGET MET — 5 ALIGNED STOCKS FOUND</div>
          )}
          {done && results.length > 0 && results.length < 5 && (
            <div style={{
              background: "#0d1a10", border: "1px solid #1a3a20", borderRadius: 4,
              padding: "9px 14px", fontSize: 11, color: "#5a8a5a",
              letterSpacing: "0.06em", textAlign: "center",
            }}>◈ {results.length} MATCH{results.length > 1 ? "ES" : ""} FOUND</div>
          )}
          {done && results.length === 0 && (
            <div style={{
              background: "#130a0a", border: "1px solid #3a1a1a", borderRadius: 4,
              padding: "9px 14px", fontSize: 11, color: "#7a3a3a",
              letterSpacing: "0.06em", textAlign: "center",
            }}>✗ NO ALIGNED STOCKS FOUND</div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: "16px auto 0", fontSize: 10, color: "#1e3550", letterSpacing: "0.05em" }}>
        {TICKERS.length} symbols · direct fetch with corsproxy.io fallback · 300ms between tickers · stops at 5
      </div>
    </div>
  );
}
