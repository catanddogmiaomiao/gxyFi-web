# gxyFi 网站

Cloudflare Worker 上的家庭资产台账。不开放注册，登录账号最多 3 个，密码只以 PBKDF2 摘要放在 Worker 密钥里，不进数据库，也不进 Git。

这本云端账和 Windows 客户端 `gxyFi` 各自保存，目前不会自动同步。iPhone 以后可以调用同一组接口：登录后使用 Cookie，或请求头 `Authorization: Bearer <session>`。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/login` | 登录。没有 `/api/register`。 |
| POST | `/api/logout` | 退出 |
| GET | `/api/state` | 当前账号的全部台账 |
| POST | `/api/mutate` | 新增、修改、删除 |
| POST | `/api/quotes/refresh` | 只刷新这个账号已有持仓的行情，最多 30 个代码，并更新美元、港币汇率 |
| GET | `/api/export.xls` | 导出 Excel 能直接打开的表格 |

行情来源与 Windows 版相同：黄金用上海黄金交易所延时行情，A 股优先东方财富、失败再用新浪，美股用 Yahoo Finance。可选密钥 `FINNHUB_TOKEN` 存在时，美股优先走 Finnhub。

## 本地运行

Wrangler 4 需要 Node.js 22 或更新版本。

```bat
npm install
python scripts\hash_user.py 你的用户名 你的密码
```

把输出放进 `.dev.vars`（这个文件不要提交）：

```text
SESSION_SECRET=一段足够长的随机字符串
AUTH_USERS=[{"username":"...","salt":"...","hash":"..."}]
```

`AUTH_USERS` 是 JSON 数组，1 到 3 个账号。超过 3 个时登录会停用。

```bat
npx wrangler d1 migrations apply gxyfi --local
npx wrangler dev
```

## 部署

先在 Cloudflare 创建 D1，把数据库 ID 写进 `wrangler.jsonc` 的 `database_id`，再执行：

```bat
npx wrangler d1 migrations apply gxyfi --remote
npx wrangler secret put SESSION_SECRET
npx wrangler secret put AUTH_USERS
npx wrangler deploy
```

`wrangler secret put` 会立即发布一个新版本。密钥不要写进 `wrangler.jsonc`。

Workers 日志和追踪已在配置里打开。自定义域名在 Cloudflare 控制台绑到这个 Worker。不要开放注册页面。

导出文件是 Excel 2003 XML（`.xls`），Excel 可以直接打开、筛选。Windows 客户端导出的是 `.xlsx`。
