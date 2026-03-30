# TRON / USDT 查询站（前端 + 后端代理 + SQLite 缓存 + SEO）

这个版本已经从“代理 + 数据缓存 + 分页 + 地址标签”继续升级为：

- 前端页面
- Node.js 后端代理
- SQLite 本地数据库缓存
- 地址交易记录分页
- 地址标签系统
- 谷歌 SEO 基础设施

适合继续扩展成：

- 商户查账系统
- 地址监控系统
- 风险标签后台
- 查询工具站 / API 服务

## 这次新增的 SEO 能力

### 1. 动态 title / description / canonical

服务端会根据不同路径输出不同的 SEO head：

- `/`
- `/address/:address`
- `/tx/:txid`

这样首页、地址页、交易页会有不同的 `<title>`、`meta description` 和 `canonical`。

### 2. robots.txt 与 sitemap.xml

项目已内置：

- `GET /robots.txt`
- `GET /sitemap.xml`

默认允许搜索引擎抓取页面，并阻止抓取 `/api/`，同时在 robots.txt 中声明 sitemap 地址。

### 3. 结构化数据

首页已加入：

- `WebSite`
- `SearchAction`
- `SoftwareApplication`
- `FAQPage`

地址页和交易页会输出：

- `WebPage`
- `BreadcrumbList`

### 4. 可抓取的内部链接与内容模块

首页新增了：

- TRON 地址查询说明
- TRON 交易查询说明
- TRC20 USDT 查询说明
- FAQ 内容
- 示例地址页内部链接

同时前端里的地址和交易哈希也从不可抓取的纯交互元素改成了真正的 `<a href>` 链接，更适合搜索引擎发现页面。

## 主要能力

### 1. 后端代理

前端不再暴露 `TRONGRID_API_KEY`，所有链上查询统一走服务端：

- `/api/query/address/:address`
- `/api/query/tx/:txid`
- `/api/labels/*`
- `/api/trongrid/*`（原始透传代理）

### 2. SQLite 数据库缓存

服务端会把常见查询写入本地 SQLite 数据库：

- 地址信息
- TRC20 余额
- 资源信息
- TRC20 交易记录页
- 交易详情 / receipt / events / internal-transactions

数据库默认位置：

```bash
./data/app.db
```

### 3. 交易记录分页

TRON 的 TRC20 交易历史接口使用 `limit + fingerprint` 分页；前端已经接成：

- 上一页
- 下一页
- 每页数量切换（20 / 50 / 100）
- 指纹游标显示

### 4. 地址标签系统

支持给地址设置：

- 标签名
- 风险级别（none / low / medium / high）
- 分类（merchant / exchange / watchlist / contract / risk / user）
- 备注

并在：

- 当前地址头部
- 地址概览
- 交易记录列表 from / to
- 交易详情页相关地址

直接显示标签。

## 运行要求

因为这个版本使用了 Node.js 内置的 `node:sqlite`，建议使用：

```bash
Node.js >= 22
```

## 安装与启动

```bash
npm install
cp .env.example .env
npm start
```

默认启动地址：

```bash
http://localhost:3000
```

## 环境变量

`.env` 示例：

```bash
PORT=3000
BASE_URL=http://localhost:3000
SITE_NAME=TRON Query Pro
TRONGRID_BASE=https://api.trongrid.io
TRONGRID_API_KEY=YOUR_TRONGRID_API_KEY
CACHE_TTL_MS=45000
USDT_CONTRACT=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
```

### SEO 上线前建议

正式部署时，记得把：

```bash
BASE_URL=http://localhost:3000
```

改成你的正式域名，例如：

```bash
BASE_URL=https://www.yourdomain.com
```

否则 robots、sitemap、canonical 和 Open Graph URL 会继续指向本地地址。

## 主要接口

### 健康检查

```bash
GET /api/health
```

### 地址聚合查询

```bash
GET /api/query/address/:address?limit=20&fingerprint=...&direction=all&keyword=...
```

### 交易聚合查询

```bash
GET /api/query/tx/:txid
```

### 标签接口

```bash
GET    /api/labels
GET    /api/labels/:address
PUT    /api/labels/:address
DELETE /api/labels/:address
```

## 当前前端已支持

- 地址查询
- 交易哈希查询
- 交易记录分页
- 筛选方向（全部 / 转入 / 转出 / 大额）
- 哈希复制
- 地址复制
- 点击地址跳转地址页
- 点击哈希跳转交易详情页
- CSV / JSON 导出
- 地址标签新增 / 编辑 / 清空
- 缓存状态提示
- 动态路由：`/address/:address`、`/tx/:txid`
- 首页 SEO 内容模块与 FAQ

## 下一步建议

最值得继续做的 5 项：

1. SSR 或预渲染更完整的地址 / 交易内容
2. 登录后台 + 标签权限管理
3. 地址监控提醒（Webhook / Telegram / 企业微信）
4. PostgreSQL 替换 SQLite 做正式生产版
5. 多地址批量查询 / 商户账单汇总
