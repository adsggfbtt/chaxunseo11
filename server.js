import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TRONGRID_BASE = (process.env.TRONGRID_BASE || 'https://api.trongrid.io').replace(/\/$/, '');
const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY || '';
const DEFAULT_CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 45000);
const USDT_CONTRACT = process.env.USDT_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const SITE_NAME = process.env.SITE_NAME || 'TRON Query Pro';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DEFAULT_DESCRIPTION = 'TRON 地址查询、TRON 交易哈希查询、TRC20 USDT 余额与交易记录查询工具，支持后端代理、缓存、分页与地址标签。';
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-default.svg`;
const DEFAULT_FAVICON = `${BASE_URL}/favicon.svg`;
const SAMPLE_ADDRESS = 'TEcC3CZqyNd32xHMGkzssFfmKzyZxRBDJY';
const SAMPLE_TX = 'f5f0d67b8a32dd6748f4dbfdb7bbf86c4c2d828534a4f38ebb9ba4c6ebe97d70';
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TXID_RE = /^[A-Fa-f0-9]{64}$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'app.db');
const templatePath = path.join(publicDir, 'index.html');

fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(dbPath);
bootstrapDb();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(publicDir, { index: false, maxAge: '7d', redirect: false }));

const ALLOWED_PREFIXES = ['/v1/', '/wallet/', '/walletsolidity/'];

function bootstrapDb() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS cache_entries (
      cache_key TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      target TEXT NOT NULL,
      request_signature TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      body_text TEXT NOT NULL,
      body_json TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache_entries(expires_at);

    CREATE TABLE IF NOT EXISTS address_labels (
      address TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'none',
      category TEXT NOT NULL DEFAULT 'user',
      note TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const count = db.prepare('SELECT COUNT(*) AS count FROM address_labels WHERE is_system = 1').get().count;
  if (!count) {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO address_labels
      (address, label, risk_level, category, note, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(USDT_CONTRACT, 'USDT 合约', 'none', 'contract', 'TRON 主网 USDT(TRC20) 合约地址。', now, now);
    stmt.run(SAMPLE_ADDRESS, '示例观察地址', 'low', 'watchlist', '演示用途：默认示例地址，可替换成你的商户地址。', now, now);
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(pathname = '/') {
  return new URL(pathname, `${BASE_URL}/`).toString();
}

function detectRouteFromRequest(req) {
  const pathname = req.path || '/';
  const addressMatch = pathname.match(/^\/address\/([A-Za-z0-9]+)$/);
  const txMatch = pathname.match(/^\/tx\/([A-Fa-f0-9]{64})$/);

  if (addressMatch && TRON_ADDRESS_RE.test(addressMatch[1])) {
    return { type: 'address', value: addressMatch[1], pathname };
  }
  if (txMatch && TXID_RE.test(txMatch[1])) {
    return { type: 'tx', value: txMatch[1].toLowerCase(), pathname: `/tx/${txMatch[1].toLowerCase()}` };
  }

  const queryAddress = String(req.query.address || '').trim();
  const queryTx = String(req.query.tx || '').trim();
  const q = String(req.query.q || '').trim();

  if (TRON_ADDRESS_RE.test(queryAddress)) {
    return { type: 'address', value: queryAddress, pathname: `/address/${queryAddress}` };
  }
  if (TXID_RE.test(queryTx)) {
    return { type: 'tx', value: queryTx.toLowerCase(), pathname: `/tx/${queryTx.toLowerCase()}` };
  }
  if (TRON_ADDRESS_RE.test(q)) {
    return { type: 'address', value: q, pathname: `/address/${q}` };
  }
  if (TXID_RE.test(q)) {
    return { type: 'tx', value: q.toLowerCase(), pathname: `/tx/${q.toLowerCase()}` };
  }

  return { type: 'home', value: '', pathname: '/' };
}

function buildStructuredData(route) {
  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: BASE_URL,
    description: DEFAULT_DESCRIPTION,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${BASE_URL}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  const softwareApp = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    description: DEFAULT_DESCRIPTION,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    url: BASE_URL,
  };

  const faqPage = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'TRON USDT 查询和普通钱包余额查询有什么区别？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'TRON USDT 查询除了 TRX 余额外，还会展示 TRC20 USDT 余额、转账记录、事件日志、资源消耗和交易状态。',
        },
      },
      {
        '@type': 'Question',
        name: '为什么要做后端代理，而不是前端直接请求 TronGrid？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '后端代理可以隐藏 API Key，统一处理缓存、限频、标签和分页，更适合正式上线与持续扩展。',
        },
      },
      {
        '@type': 'Question',
        name: '这个站支持什么查询？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '当前支持 TRON 地址查询、TRON 交易哈希查询，以及 TRC20 USDT 余额和交易记录查询。',
        },
      },
    ],
  };

  if (route.type === 'address') {
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: `TRON 地址查询 ${route.value}`,
        description: `查询 TRON 地址 ${route.value} 的 TRX 余额、USDT(TRC20) 持仓、资源信息与最近交易记录。`,
        url: absoluteUrl(route.pathname),
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: BASE_URL },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: BASE_URL },
          { '@type': 'ListItem', position: 2, name: '地址查询', item: absoluteUrl(route.pathname) },
        ],
      },
    ];
  }

  if (route.type === 'tx') {
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: `TRON 交易查询 ${route.value}`,
        description: `查询 TRON 交易哈希 ${route.value} 的状态、手续费、区块、事件日志和内部交易。`,
        url: absoluteUrl(route.pathname),
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: BASE_URL },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: BASE_URL },
          { '@type': 'ListItem', position: 2, name: '交易查询', item: absoluteUrl(route.pathname) },
        ],
      },
    ];
  }

  return [website, softwareApp, faqPage];
}

function buildSeoPayload(route) {
  if (route.type === 'address') {
    return {
      title: `TRON 地址查询 ${route.value} | ${SITE_NAME}`,
      description: `查询 TRON 地址 ${route.value} 的 TRX 余额、USDT(TRC20) 持仓、资源信息与最近交易记录。`,
      canonical: absoluteUrl(route.pathname),
      robots: 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1',
      ogType: 'website',
      structuredData: buildStructuredData(route),
    };
  }

  if (route.type === 'tx') {
    return {
      title: `TRON 交易查询 ${route.value} | ${SITE_NAME}`,
      description: `查询 TRON 交易哈希 ${route.value} 的状态、手续费、区块、事件日志和内部交易。`,
      canonical: absoluteUrl(route.pathname),
      robots: 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1',
      ogType: 'website',
      structuredData: buildStructuredData(route),
    };
  }

  return {
    title: `${SITE_NAME} | TRON 地址查询与 USDT 交易查询工具`,
    description: DEFAULT_DESCRIPTION,
    canonical: absoluteUrl('/'),
    robots: 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1',
    ogType: 'website',
    structuredData: buildStructuredData(route),
  };
}

function renderSeoHead(seo) {
  const scripts = seo.structuredData
    .map((item) => `<script type="application/ld+json">${JSON.stringify(item)}</script>`)
    .join('\n  ');

  return `
  <title>${escapeHtml(seo.title)}</title>
  <meta name="description" content="${escapeHtml(seo.description)}" />
  <meta name="robots" content="${escapeHtml(seo.robots)}" />
  <meta name="googlebot" content="${escapeHtml(seo.robots)}" />
  <link rel="canonical" href="${escapeHtml(seo.canonical)}" />
  <meta name="theme-color" content="#07101b" />
  <meta property="og:locale" content="zh_CN" />
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
  <meta property="og:type" content="${escapeHtml(seo.ogType)}" />
  <meta property="og:title" content="${escapeHtml(seo.title)}" />
  <meta property="og:description" content="${escapeHtml(seo.description)}" />
  <meta property="og:url" content="${escapeHtml(seo.canonical)}" />
  <meta property="og:image" content="${escapeHtml(DEFAULT_OG_IMAGE)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(seo.title)}" />
  <meta name="twitter:description" content="${escapeHtml(seo.description)}" />
  <meta name="twitter:image" content="${escapeHtml(DEFAULT_OG_IMAGE)}" />
  <link rel="icon" href="${escapeHtml(DEFAULT_FAVICON)}" type="image/svg+xml" />
  <link rel="manifest" href="/manifest.webmanifest" />
  ${scripts}`;
}

function renderIndexHtml(route) {
  const template = fs.readFileSync(templatePath, 'utf8');
  const seo = buildSeoPayload(route);
  const html = template
    .replace('<!--SEO_HEAD-->', renderSeoHead(seo))
    .replace('__INITIAL_ROUTE__', JSON.stringify(route))
    .replace('__SEO_DEFAULTS__', JSON.stringify({
      siteName: SITE_NAME,
      defaultDescription: DEFAULT_DESCRIPTION,
    }));

  return html;
}

function isAllowedPath(pathname) {
  return ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = sortObject(value[key]);
    return acc;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function normalizeTargetPath(inputPath) {
  return inputPath.startsWith('/') ? inputPath : `/${inputPath}`;
}

function buildForwardHeaders(hasBody) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'tron-query-proxy/2.0',
  };

  if (TRONGRID_API_KEY) {
    headers['TRON-PRO-API-KEY'] = TRONGRID_API_KEY;
  }

  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function cacheKeyFor({ method, pathname, params = {}, body = {} }) {
  const signature = stableStringify({ method, pathname, params, body });
  const hash = crypto.createHash('sha256').update(signature).digest('hex');
  return { cacheKey: hash, signature };
}

function ttlForRequest(pathname) {
  if (pathname.includes('/transactions/trc20')) return 20000;
  if (pathname.includes('/trc20/balance')) return 45000;
  if (pathname.includes('/events')) return 120000;
  if (pathname.includes('/internal-transactions')) return 120000;
  if (pathname.includes('gettransactioninfobyid')) return 120000;
  if (pathname.includes('gettransactionbyid')) return 120000;
  if (pathname.includes('getaccountresource')) return 45000;
  if (pathname.includes('/v1/accounts/')) return 45000;
  return DEFAULT_CACHE_TTL_MS;
}

function getCachedEntry(cacheKey) {
  const row = db.prepare(`
    SELECT cache_key, status_code, content_type, body_text, body_json, expires_at, updated_at
    FROM cache_entries
    WHERE cache_key = ?
  `).get(cacheKey);

  if (!row) return null;
  if (Number(row.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM cache_entries WHERE cache_key = ?').run(cacheKey);
    return null;
  }

  let parsedJson = null;
  if (row.body_json) {
    try {
      parsedJson = JSON.parse(row.body_json);
    } catch {
      parsedJson = null;
    }
  }

  return {
    ...row,
    parsedJson,
    cacheHit: true,
  };
}

function putCachedEntry({ cacheKey, method, target, requestSignature, statusCode, contentType, bodyText, bodyJson, ttlMs }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO cache_entries
    (cache_key, method, target, request_signature, status_code, content_type, body_text, body_json, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      method = excluded.method,
      target = excluded.target,
      request_signature = excluded.request_signature,
      status_code = excluded.status_code,
      content_type = excluded.content_type,
      body_text = excluded.body_text,
      body_json = excluded.body_json,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(
    cacheKey,
    method,
    target,
    requestSignature,
    statusCode,
    contentType,
    bodyText,
    bodyJson ? JSON.stringify(bodyJson) : null,
    now + ttlMs,
    now,
    now,
  );
}

function sweepExpiredCache() {
  db.prepare('DELETE FROM cache_entries WHERE expires_at <= ?').run(Date.now());
}

function getLabelByAddress(address) {
  if (!address) return null;
  return db.prepare(`
    SELECT address, label, risk_level AS riskLevel, category, note, is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
    FROM address_labels
    WHERE address = ?
  `).get(address) || null;
}

function getLabelsMap(addresses = []) {
  const clean = [...new Set(addresses.filter(Boolean))];
  if (!clean.length) return {};
  const placeholders = clean.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT address, label, risk_level AS riskLevel, category, note, is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
    FROM address_labels
    WHERE address IN (${placeholders})
  `).all(...clean);

  return rows.reduce((acc, row) => {
    acc[row.address] = row;
    return acc;
  }, {});
}

function upsertLabel(address, payload = {}) {
  const now = Date.now();
  const label = String(payload.label || '').trim();
  const riskLevel = String(payload.riskLevel || 'none').trim() || 'none';
  const category = String(payload.category || 'user').trim() || 'user';
  const note = String(payload.note || '').trim();

  if (!label) {
    throw new Error('label is required');
  }

  db.prepare(`
    INSERT INTO address_labels
    (address, label, risk_level, category, note, is_system, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(address) DO UPDATE SET
      label = excluded.label,
      risk_level = excluded.risk_level,
      category = excluded.category,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run(address, label, riskLevel, category, note, now, now);

  return getLabelByAddress(address);
}

function deleteLabel(address) {
  const existing = getLabelByAddress(address);
  if (!existing) return false;
  db.prepare('DELETE FROM address_labels WHERE address = ? AND is_system = 0').run(address);
  return true;
}

function jsonResponseFromText(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

function nextFingerprintFromResponse(data) {
  return data?.meta?.fingerprint || data?.fingerprint || data?.meta?.next_fingerprint || null;
}

async function fetchTron({ method = 'GET', pathname, params = {}, body = {}, forceRefresh = false, ttlMs }) {
  const normalizedPath = normalizeTargetPath(pathname);
  if (!isAllowedPath(normalizedPath)) {
    throw new Error(`Disallowed proxy path: ${normalizedPath}`);
  }
  if (!TRONGRID_API_KEY) {
    throw new Error('Server is missing TRONGRID_API_KEY.');
  }

  const effectiveTtl = Number(ttlMs || ttlForRequest(normalizedPath));
  const hasBody = method === 'POST';
  const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const cleanBody = hasBody ? sortObject(body || {}) : {};
  const { cacheKey, signature } = cacheKeyFor({ method, pathname: normalizedPath, params: cleanParams, body: cleanBody });

  if (!forceRefresh) {
    const cached = getCachedEntry(cacheKey);
    if (cached) {
      return {
        statusCode: cached.status_code,
        contentType: cached.content_type,
        data: cached.parsedJson ?? jsonResponseFromText(cached.body_text),
        rawText: cached.body_text,
        cache: {
          hit: true,
          updatedAt: Number(cached.updated_at),
          expiresAt: Number(cached.expires_at),
        },
      };
    }
  }

  const url = new URL(normalizedPath, TRONGRID_BASE);
  Object.entries(cleanParams).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const upstreamRes = await fetch(url, {
    method,
    headers: buildForwardHeaders(hasBody),
    body: hasBody ? JSON.stringify(cleanBody) : undefined,
  });

  const contentType = upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8';
  const text = await upstreamRes.text();
  const data = jsonResponseFromText(text);

  if (!upstreamRes.ok) {
    const errorMessage = data?.message || data?.error || `HTTP ${upstreamRes.status}`;
    const err = new Error(errorMessage);
    err.statusCode = upstreamRes.status;
    err.payload = data || text;
    throw err;
  }

  putCachedEntry({
    cacheKey,
    method,
    target: `${normalizedPath}?${new URLSearchParams(cleanParams).toString()}`,
    requestSignature: signature,
    statusCode: upstreamRes.status,
    contentType,
    bodyText: text,
    bodyJson: data,
    ttlMs: effectiveTtl,
  });

  return {
    statusCode: upstreamRes.status,
    contentType,
    data,
    rawText: text,
    cache: {
      hit: false,
      updatedAt: Date.now(),
      expiresAt: Date.now() + effectiveTtl,
    },
  };
}

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const statusCode = Number(error?.statusCode || 500);
      res.status(statusCode >= 400 ? statusCode : 500).json({
        error: error instanceof Error ? error.message : String(error),
        detail: error?.payload || null,
      });
    }
  };
}

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${absoluteUrl('/sitemap.xml')}\n`);
});

app.get('/sitemap.xml', (_req, res) => {
  const now = new Date().toISOString();
  const urls = [
    absoluteUrl('/'),
    absoluteUrl(`/address/${SAMPLE_ADDRESS}`),
    absoluteUrl(`/address/${USDT_CONTRACT}`),
    absoluteUrl(`/tx/${SAMPLE_TX}`),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((loc) => `  <url><loc>${escapeHtml(loc)}</loc><lastmod>${now}</lastmod></url>`).join('\n')}\n</urlset>`;
  res.type('application/xml').send(xml);
});

app.get('/api/health', asyncRoute(async (_req, res) => {
  sweepExpiredCache();
  const cacheStats = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END), 0) AS active
    FROM cache_entries
  `).get(Date.now());

  const labelStats = db.prepare('SELECT COUNT(*) AS total FROM address_labels').get();

  res.json({
    ok: true,
    mode: 'proxy+db',
    upstream: TRONGRID_BASE,
    hasApiKey: Boolean(TRONGRID_API_KEY),
    database: dbPath,
    baseUrl: BASE_URL,
    cache: {
      total: Number(cacheStats.total || 0),
      active: Number(cacheStats.active || 0),
      defaultTtlMs: DEFAULT_CACHE_TTL_MS,
    },
    labels: {
      total: Number(labelStats.total || 0),
    },
  });
}));

app.get('/api/cache/stats', asyncRoute(async (_req, res) => {
  sweepExpiredCache();
  const rows = db.prepare(`
    SELECT method, target, expires_at AS expiresAt, updated_at AS updatedAt
    FROM cache_entries
    WHERE expires_at > ?
    ORDER BY updated_at DESC
    LIMIT 30
  `).all(Date.now());

  res.json({ ok: true, rows });
}));

app.get('/api/labels', asyncRoute(async (req, res) => {
  const addressesParam = String(req.query.addresses || '').trim();
  if (!addressesParam) {
    const rows = db.prepare(`
      SELECT address, label, risk_level AS riskLevel, category, note, is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
      FROM address_labels
      ORDER BY updated_at DESC
      LIMIT 100
    `).all();
    return res.json({ ok: true, labels: rows });
  }

  const addresses = addressesParam.split(',').map((item) => item.trim()).filter(Boolean);
  return res.json({ ok: true, labels: getLabelsMap(addresses) });
}));

app.get('/api/labels/:address', asyncRoute(async (req, res) => {
  const label = getLabelByAddress(req.params.address);
  res.json({ ok: true, label });
}));

app.put('/api/labels/:address', asyncRoute(async (req, res) => {
  const saved = upsertLabel(req.params.address, req.body || {});
  res.json({ ok: true, label: saved });
}));

app.delete('/api/labels/:address', asyncRoute(async (req, res) => {
  const removed = deleteLabel(req.params.address);
  res.json({ ok: true, removed });
}));

app.get('/api/query/address/:address', asyncRoute(async (req, res) => {
  const address = String(req.params.address || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 200);
  const fingerprint = String(req.query.fingerprint || '').trim();
  const keyword = String(req.query.keyword || '').trim();
  const direction = String(req.query.direction || 'all').trim();
  const forceRefresh = String(req.query.refresh || '') === '1';

  const [accountResp, trc20BalanceResp, resourceResp, txResp] = await Promise.all([
    fetchTron({ method: 'GET', pathname: `/v1/accounts/${address}`, forceRefresh }),
    fetchTron({ method: 'GET', pathname: `/v1/accounts/${address}/trc20/balance`, forceRefresh }),
    fetchTron({ method: 'POST', pathname: '/wallet/getaccountresource', body: { address, visible: true }, forceRefresh }),
    fetchTron({
      method: 'GET',
      pathname: `/v1/accounts/${address}/transactions/trc20`,
      params: {
        only_confirmed: 'true',
        limit,
        contract_address: USDT_CONTRACT,
        order_by: 'block_timestamp,desc',
        fingerprint,
      },
      forceRefresh,
    }),
  ]);

  let transactions = Array.isArray(txResp.data?.data) ? txResp.data.data : [];

  if (direction === 'in') transactions = transactions.filter((item) => (item.to || item.to_address || item.toAddress) === address);
  if (direction === 'out') transactions = transactions.filter((item) => (item.from || item.from_address || item.fromAddress) === address);
  if (direction === 'large') transactions = transactions.filter((item) => Number(item.value || item.amount || 0) >= 1000 * 1e6 || Number(item.value || item.amount || 0) >= 1000);
  if (keyword) {
    const lower = keyword.toLowerCase();
    transactions = transactions.filter((item) => {
      return [
        item.transaction_id,
        item.from,
        item.from_address,
        item.to,
        item.to_address,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(lower));
    });
  }

  const addressPool = [
    address,
    ...transactions.flatMap((item) => [item.from || item.from_address || item.fromAddress, item.to || item.to_address || item.toAddress]),
  ].filter(Boolean);

  res.json({
    ok: true,
    address,
    account: accountResp.data,
    trc20Balance: trc20BalanceResp.data,
    resources: resourceResp.data,
    transactions,
    pagination: {
      limit,
      fingerprint: fingerprint || null,
      nextFingerprint: nextFingerprintFromResponse(txResp.data),
      hasNext: Boolean(nextFingerprintFromResponse(txResp.data)),
    },
    label: getLabelByAddress(address),
    labels: getLabelsMap(addressPool),
    cache: {
      account: accountResp.cache,
      balance: trc20BalanceResp.cache,
      resources: resourceResp.cache,
      transactions: txResp.cache,
    },
  });
}));

app.get('/api/query/tx/:txid', asyncRoute(async (req, res) => {
  const txid = String(req.params.txid || '').trim();
  const forceRefresh = String(req.query.refresh || '') === '1';

  const [rawResp, infoResp, eventResp, internalResp] = await Promise.all([
    fetchTron({ method: 'POST', pathname: '/wallet/gettransactionbyid', body: { value: txid, visible: true }, forceRefresh }),
    fetchTron({ method: 'POST', pathname: '/wallet/gettransactioninfobyid', body: { value: txid, visible: true }, forceRefresh }),
    fetchTron({ method: 'GET', pathname: `/v1/transactions/${txid}/events`, params: { only_confirmed: 'true' }, forceRefresh }),
    fetchTron({ method: 'GET', pathname: `/v1/transactions/${txid}/internal-transactions`, forceRefresh }),
  ]);

  const raw = rawResp.data || {};
  const info = infoResp.data || {};
  const events = Array.isArray(eventResp.data?.data) ? eventResp.data.data : [];
  const internal = Array.isArray(internalResp.data?.data) ? internalResp.data.data : [];

  const addresses = [
    raw?.raw_data?.contract?.[0]?.parameter?.value?.owner_address,
    raw?.raw_data?.contract?.[0]?.parameter?.value?.to_address,
    raw?.raw_data?.contract?.[0]?.parameter?.value?.contract_address,
    ...events.flatMap((evt) => [evt?.result?.from, evt?.result?.to, evt?.contract_address]),
    ...internal.flatMap((item) => [item?.caller_address, item?.transferTo_address]),
  ].filter(Boolean);

  res.json({
    ok: true,
    txid,
    raw,
    info,
    events,
    internal,
    labels: getLabelsMap(addresses),
    cache: {
      raw: rawResp.cache,
      info: infoResp.cache,
      events: eventResp.cache,
      internal: internalResp.cache,
    },
  });
}));

app.all(/^\/api\/trongrid\/.*/, asyncRoute(async (req, res) => {
  const suffix = req.originalUrl.slice('/api/trongrid'.length);
  const targetUrl = new URL(suffix, TRONGRID_BASE);

  if (!isAllowedPath(targetUrl.pathname)) {
    return res.status(400).json({ error: 'Disallowed proxy path.', path: targetUrl.pathname });
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const params = Object.fromEntries(targetUrl.searchParams.entries());
  const result = await fetchTron({
    method: req.method,
    pathname: targetUrl.pathname,
    params,
    body: req.method === 'POST' ? (req.body || {}) : {},
    forceRefresh: String(req.query.refresh || '') === '1',
  });

  res.setHeader('Content-Type', result.contentType);
  res.status(result.statusCode).send(result.rawText);
}));

function renderAppShell(req, res) {
  const route = detectRouteFromRequest(req);
  res.type('html').send(renderIndexHtml(route));
}

app.get(['/', '/index.html', '/search', '/address/:address', '/tx/:txid'], renderAppShell);

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (path.extname(req.path)) return next();
  return renderAppShell(req, res);
});

app.use((_req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

app.listen(PORT, () => {
  console.log(`TRON proxy app running at ${BASE_URL}`);
});
