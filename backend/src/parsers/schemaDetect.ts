type Row = Record<string, string>;

const ROLE_CHECKS: { [role: string]: (v: string) => number } = {
  login: (v) => /@/.test(v) ? 1 : 0,
  cip: (v) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(v) ? 1 : 0,
  host: (v) => !!v && (v.startsWith("http") || /\./.test(v)) ? 0.6 : 0,
  url: (v) => !!v && (v.startsWith("http") || v.includes("/")) ? 1 : 0,
  method: (v) => /^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)$/.test((v||"").toUpperCase()) ? 1 : 0,
  status: (v) => /^[1-5][0-9][0-9]$/.test(String(v)) ? 1 : 0,
  bytes_out: (v) => /^[-+]?\d[\d, ]*$/.test(String(v)) ? 1 : 0,
  bytes_in: (v) => /^[-+]?\d[\d, ]*$/.test(String(v)) ? 1 : 0,
  useragent: (v) => !!v && v.length > 10 && /Mozilla|AppleWebKit|Chrome|Firefox|Safari|curl|bot/i.test(v) ? 1 : 0,
  category: (v) => !!v && v.length < 50 && /^[a-zA-Z0-9_\- ]+$/.test(v) ? 0.2 : 0,
  action: (v) => /allow|deny|blocked|allowed|accept|drop/i.test(v) ? 1 : 0,
  country: (v) => /^[A-Z]{2}$/.test(String(v)) ? 1 : 0,
  city: (v) => !!v && /^[A-Za-z\-\s]+$/.test(v) ? 0.3 : 0,
};

const KEYMAP_ALIASES: { [role: string]: string[] } = {
  login: ["login","user","username"],
  cip: ["cip","src_ip","source_ip","clientip","ip","srcip"],
  host: ["host","domain","site"],
  url: ["url","request","uri","path"],
  method: ["method","reqmethod","http_method","verb"],
  status: ["status","respcode","status_code","http_status"],
  bytes_out: ["bytes_out","bytesout","reqsize","sentbytes","bytes"],
  bytes_in: ["bytes_in","bytesin","respsize","recvbytes"],
  useragent: ["useragent","ua","user_agent"],
  category: ["category","categories"],
  action: ["action","decision"],
  country: ["country"],
  city: ["city"],
};

function headerNameScore(header: string, role: string) {
  const h = header.toLowerCase();
  const aliases = KEYMAP_ALIASES[role] || [];
  function esc(a: string) { return a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  for (const a of aliases) {
    const la = a.toLowerCase();
    if (h === la) return 1;
    // whole-word match (avoid matching 'user' inside 'userAgent')
    const re = new RegExp(`\\b${esc(la)}\\b`);
    if (re.test(h)) return 0.95;
    if (h.startsWith(la) || h.endsWith(la)) return 0.85;
    if (h.includes(la)) return 0.6;
  }
  // some heuristics
  if (role === 'status' && /status|resp/.test(h)) return 0.8;
  if ((role === 'bytes_out' || role === 'bytes_in') && /byte|size|len/.test(h)) return 0.8;
  if (role === 'useragent' && /agent|useragent|ua/.test(h)) return 0.9;
  return 0;
}

export function inferCsvMapping(headers: string[], sampleRows: Row[], roles?: string[]) {
  const candidateRoles = roles ?? Object.keys(KEYMAP_ALIASES);
  const colValues: { [h: string]: string[] } = {};
  for (const h of headers) colValues[h] = [];
  for (const r of sampleRows) {
    for (const h of headers) {
      const v = r[h];
      if (v !== undefined && v !== null) colValues[h].push(String(v));
    }
  }

  // score each header for each role
  const scores: { [h: string]: { [role: string]: number } } = {};
  for (const h of headers) {
    scores[h] = {};
    for (const role of candidateRoles) {
      let score = headerNameScore(h, role) * 0.4; // name weight (reduced)
      const vals = colValues[h].slice(0, 20);
      let valScore = 0;
      if (vals.length) {
        const chk = ROLE_CHECKS[role];
        if (chk) {
          let acc = 0;
          for (const v of vals) acc += chk(v);
          valScore = acc / vals.length; // 0..1
        }
      }
      score += valScore * 0.6; // value weight (increased)
      scores[h][role] = Math.min(1, score);
    }
  }

  // Assign best header per role greedily
  const mapping: { [role: string]: string | null } = {};
  const assignedHeaders = new Set<string>();
  for (const role of candidateRoles) {
    let bestH: string | null = null;
    let bestScore = 0;
    for (const h of headers) {
      if (assignedHeaders.has(h)) continue;
      const sc = scores[h][role] ?? 0;
      if (sc > bestScore) { bestScore = sc; bestH = h; }
    }
    mapping[role] = bestH && bestScore > 0.15 ? bestH : null;
    if (bestH) assignedHeaders.add(bestH);
  }

  // overall confidence: average of chosen scores
  const confidences: number[] = [];
  for (const role of candidateRoles) {
    const h = mapping[role];
    if (!h) continue;
    confidences.push(scores[h][role] ?? 0);
  }
  const overall = confidences.length ? (confidences.reduce((a,b)=>a+b,0)/confidences.length) : 0;
  return { mapping, confidence: overall, scores };
}

export function detectTextFormat(sampleLine: string) {
  const s = sampleLine.trim();
  if (!s) return 'unknown';
  if (s.startsWith('{') || s.startsWith('[')) return 'json';
  if (s.startsWith('#Fields:')) return 'w3c';
  // combined log example contains [dd/Mon/yyyy:.. +0000]
  if (/\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4}/.test(s)) return 'combined';
  return 'text';
}

export type InferResult = {
  mapping: { [role: string]: string | null };
  confidence: number;
  scores: any;
};

export default { inferCsvMapping, detectTextFormat };
