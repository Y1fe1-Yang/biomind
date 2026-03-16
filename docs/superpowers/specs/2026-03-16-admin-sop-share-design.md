# BioMiND 扩展功能设计文档

**日期：** 2026-03-16
**范围：** 管理员面板 · 用户 SOP/分享上传 · SOP 社交功能 · 页脚
**开发策略：** 方案 B — 先合并数据模型 PR，再开三个并行 worktree

---

## 1. 总体架构

### 开发顺序

```
main
 └─ [PR-0] 数据模型基础（先合入，包含页脚静态部分）
      ├─ worktree: admin-panel     （可随时合入 main）
      ├─ worktree: sop-upload      （先于 sop-social 合入）
      └─ worktree: sop-social      （最后合入，依赖 sop-upload 的路由文件）
```

### 新增视图

| Hash | 访问权限 | 说明 |
|---|---|---|
| `#admin` | 登录 + is_admin | 管理后台 |
| `#share` | 登录 | 组内分享 |
| `#sops` | 登录（已有，扩展） | 系统 SOP + 用户上传 SOP |

---

## 2. 数据模型

### 2.1 用户上传内容 — `data/user-sops.json`

**ID 生成规则（权威定义）：** `"{type}-{username}-{YYYY-MM}-{slug}"` 其中 slug 由 title.zh 的前 20 字符转小写、非字母数字替换为连字符生成，最终 ID 截断至 60 字符。由 `sop_store.py` 的 `generate_sop_id(type, username, date, title_zh)` 函数统一生成，`social_store.py` 直接使用此 ID，不自行生成。

```json
[
  {
    "id": "sop-alice-2026-03-pcr",
    "type": "sop",
    "title": { "zh": "PCR 操作规程", "en": "PCR Protocol" },
    "description": { "zh": "...", "en": "..." },
    "file": "user-sops/alice/1711234567890.pdf",
    "fileType": "pdf",
    "mdContent": "",
    "tags": ["PCR", "分子生物学"],
    "uploadedBy": "alice",
    "uploadedAt": 1711234567.0,
    "updatedAt": null,
    "status": "active",
    "likeCount": 0,
    "bookmarkCount": 0,
    "commentCount": 0
  }
]
```

**type 字段：** `"sop"` | `"share"`
**fileType：** `"pdf"` | `"docx"` | `"md"`（md 类型时正文存 `mdContent`，`file` 为空字符串）
**status：** `"active"` | `"removed"`（管理员软下架）
**updatedAt：** 初始为 `null`，每次 PUT 编辑后更新为当前时间戳

**文件上传约束：**
- 最大文件大小：20 MB（在 `routers/sops.py` 中检查 `file.size`，超出返回 400）
- 服务端 MIME 验证：读取文件头部 magic bytes，PDF（`%PDF`）、docx（PK zip header）、md 无二进制头（直接按文本处理）；MIME 与扩展名不符时返回 400
- Markdown 内容：存储前用 `html.escape()` 对原始内容不做处理（渲染时前端负责安全渲染，禁止 `innerHTML` 直接插入，使用现有 `_renderMd()` 函数）

### 2.2 社交数据 — 新增三张表到 `data/users.db`

```sql
CREATE TABLE IF NOT EXISTS sop_likes (
    sop_id     TEXT NOT NULL,
    username   TEXT NOT NULL,
    created_at REAL NOT NULL,
    PRIMARY KEY (sop_id, username)
);

CREATE TABLE IF NOT EXISTS sop_bookmarks (
    sop_id     TEXT NOT NULL,
    username   TEXT NOT NULL,
    created_at REAL NOT NULL,
    PRIMARY KEY (sop_id, username)
);

CREATE TABLE IF NOT EXISTS sop_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sop_id     TEXT NOT NULL,
    username   TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_sop ON sop_comments(sop_id);
```

迁移脚本：`scripts/migrate_social.py` — 直接运行即可，幂等（使用 `CREATE TABLE IF NOT EXISTS`）。

### 2.3 AI 配置 — `data/ai_config.json`

```json
{
  "provider": "zhipu",
  "keys": {
    "zhipu": "sk-...",
    "claude": "",
    "kimi": ""
  }
}
```

- 文件加入 `.gitignore`，不提交到 git
- `config.py` 每次请求时调用 `ai_config_store.get_config()`，优先使用文件中的非空值，fallback 到环境变量
- 管理员 GET 时 key 脱敏：非空 key 返回 `"****" + key[-4:]`，空 key 返回空字符串
- 管理员 PUT 时：若某个 key 字段为空字符串，表示「清除该 key，回退到环境变量」；若字段缺失（未传），表示「保持现有值不变」。`provider` 字段必传，不能为空。

### 2.4 成员数据 — 迁移到 `data/members.json`

`data/members.js`（`window.MEMBERS`）改为由 `data/members.json` 生成。

**再生成机制（权威定义）：** `members_store.py` 暴露 `save_members(data: list) -> None` 函数，该函数：①将数据写入 `data/members.json`；②立即重新生成 `data/members.js`（内容为 `window.MEMBERS = {...};`）。所有路由中的写操作必须调用 `save_members()`，不得直接操作 JSON 文件。

成员对象结构保持现有 `window.MEMBERS` 格式不变。

### 2.5 论文元数据编辑

可编辑字段：`title`、`authors`、`abstract`、`doi`、`directions`、`notes`。
**再生成机制（权威定义）：** `backend/services/data_store.py`（新建）暴露 `save_paper(paper_id: str, updates: dict) -> dict | None` 函数，写入 `data/data.json` 后立即重新生成 `data/data.js`（内容为 `window.DATA = {...};`）。

`paper_id` 为 `data/data.json` 中 papers/books/sops 数组各条目的 `"id"` 字段（字符串 slug，如 `"yanganalchem2010"`）。

### 2.6 页脚配置 — `data/footer_config.json`

```json
{
  "links": [
    { "label": "中科院深圳先进院", "url": "https://www.siat.ac.cn" },
    { "label": "BioMiND Lab", "url": "https://biomind.siat.ac.cn" }
  ]
}
```

管理员可在管理面板增删改友情链接（label + url），写入此文件后立即生效（前端下次渲染时从 `/data/footer_config.json` 读取）。

---

## 3. API 设计

### 3.1 PR-0 — 数据模型基础（无新端点，仅文件迁移与占位）

- 新建 `data/user-sops.json`（空数组 `[]`）
- 新建 `data/ai_config.json`（从当前环境变量初始化）
- 新建 `data/footer_config.json`（含 SIAT 默认链接）
- 运行 `scripts/migrate_social.py` 建社交三表
- 从现有 `data/members.js` 提取 `window.MEMBERS` 数据写入 `data/members.json`
- `index.html` 加 `#view-admin`、`#view-share` 空占位 + 页脚 HTML（含静态 logo）
- `app.js` 路由表注册新视图，render 函数留空占位
- `data/footer_config.json` 加入 `.gitignore` 例外（不忽略，友情链接提交到 git）
- `data/ai_config.json` 加入 `.gitignore`

### 3.2 Worktree: admin-panel

所有端点加 `Depends(admin_required)`。

```
GET    /api/admin/members              → 返回完整成员列表（含所有字段）
POST   /api/admin/members              → 新增成员（调用 save_members()）
PUT    /api/admin/members/{member_id}  → 编辑成员（调用 save_members()）
DELETE /api/admin/members/{member_id}  → 删除成员（调用 save_members()）

PUT    /api/admin/papers/{paper_id}    → 编辑论文元数据（调用 save_paper()）
                                         paper_id 为 data.json 中的 id 字段

GET    /api/admin/ai-config            → 读取 provider + 脱敏 key
PUT    /api/admin/ai-config            → 更新 provider 和/或 key

GET    /api/admin/footer               → 读取友情链接列表
PUT    /api/admin/footer               → 更新友情链接列表（整体替换）

# 新闻管理复用现有端点（POST/PUT/DELETE /api/news/...），无需新增
```

新后端文件：
- `backend/routers/admin.py`
- `backend/services/members_store.py`（含 `save_members()`）
- `backend/services/ai_config_store.py`
- `backend/services/data_store.py`（含 `save_paper()`）

### 3.3 Worktree: sop-upload

```
GET    /api/sops                       → 列出所有 active 内容（需登录）
                                         ?type=sop|share 可过滤；无分页（本期不做）
POST   /api/sops                       → 上传（multipart: file 或 mdContent + type + title_zh + title_en + description_zh + tags）
GET    /api/sops/{id}                  → 单篇详情
PUT    /api/sops/{id}                  → 编辑 title/description/tags（owner 或 admin）
                                         同时更新 updatedAt 字段
DELETE /api/sops/{id}                  → 硬删除（仅 owner 或 admin 可调用；同时删除物理文件）
POST   /api/admin/sops/{id}/remove     → 管理员软下架（status → removed，不删文件，需 admin_required）
```

**DELETE 权限说明：** 管理员应优先使用 `/remove` 软下架（保留文件）；`DELETE` 硬删除同时对 owner 和 admin 开放，admin 用于彻底清理违规内容。两个端点并存，行为不同。

文件存储：`data/user-sops/{username}/{timestamp}{ext}`，通过 `StaticFiles` 挂载到 `/data/user-sops/`。

新后端文件：`backend/routers/sops.py`、`backend/services/sop_store.py`（含 `generate_sop_id()`）

### 3.4 Worktree: sop-social

```
POST   /api/sops/{id}/like                    → 切换点赞（幂等：重复调用只改变状态，不增加计数）
                                                返回 {"liked": true, "count": 12}
POST   /api/sops/{id}/bookmark                → 切换收藏（同上）
                                                返回 {"bookmarked": true, "count": 5}
GET    /api/sops/{id}/comments                → 评论列表（时间正序）
POST   /api/sops/{id}/comments                → 发评论（需登录，content 最长 500 字符）
DELETE /api/sops/{id}/comments/{comment_id}   → 删评论（comment owner 或 admin）
```

点赞/收藏切换逻辑：若记录存在则删除（取消），若不存在则插入（添加）；同时用 SQL 更新 `user_sops.likeCount` / `bookmarkCount`。

新后端文件：`backend/services/social_store.py`（SQLite 操作）
修改已有文件：`backend/routers/sops.py`（在 sop-upload 合入 main 后操作）

---

## 4. 前端架构

### 4.1 PR-0 在 app.js 中的改动

```javascript
// 需登录的视图列表（PR-0 扩展现有逻辑）
const AUTH_REQUIRED_VIEWS = new Set(["sops", "share", "admin"]);
const ADMIN_REQUIRED_VIEWS = new Set(["admin"]);

// renderView dispatch 新增（填充空函数体由各 worktree 负责）
case "admin": renderAdmin(); break;
case "share": renderShare(); break;

// 空占位函数
function renderAdmin()       { /* TODO: admin-panel worktree */ }
function renderShare()       { /* TODO: sop-upload worktree */ }
function renderSopDetail(id) { /* TODO: sop-upload worktree */ }
```

### 4.2 各 worktree 负责的前端范围

**admin-panel：**
- `#view-admin` 内部 HTML（选项卡式：成员 / 论文 / 新闻 / AI配置 / 页脚链接）
- `renderAdmin()` 及子函数（`renderAdminMembers()`, `renderAdminPapers()`, `renderAdminNews()`, `renderAdminAI()`, `renderAdminFooter()`）

**sop-upload：**
- `#view-sops` 中加入用户上传 SOP 列表区块（系统 SOP 列表保持不动，追加用户 SOP 区块）
- `#view-share` 完整 HTML
- `renderSops()` 中追加用户 SOP 渲染逻辑（**不重写现有 renderSops() 函数体，在函数末尾追加调用 `renderUserSops()`**）
- `renderShare()`、`renderSopDetail(id)` 完整实现
- 上传模态框（`#modal-sop-upload`）

**sop-social：**
- `renderSopDetail()` 中追加社交区块（在 sop-upload 的 renderSopDetail 函数末尾调用 `renderSopSocial(id)`）
- `renderSopSocial(id)` 完整实现（点赞/收藏按钮 + 评论列表 + 评论输入框）

### 4.3 UI/UX 一致性规范

| 元素 | Tailwind 类名 |
|---|---|
| 卡片容器 | `bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition` |
| 主操作按钮 | `bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700` |
| 次要按钮 | `border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm hover:bg-gray-50` |
| 危险按钮 | `text-red-600 hover:text-red-700 text-sm` |
| 表单输入框 | `border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500` |
| 模态框遮罩 | 复用现有 `auth-modal` 的 `fixed inset-0 bg-black/40 z-50` 样式 |
| 标签/badge | `text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700` |
| 分区标题 | `text-lg font-bold text-gray-900 mb-4` |

---

## 5. 页脚设计

### 静态部分（PR-0 直接写入 index.html）

```
┌──────────────────────────────────────────────────────┐
│  [SIAT Logo]  中国科学院深圳先进技术研究院           │
│                                                      │
│  友情链接：[管理员配置的链接列表，从 footer_config.json 加载] │
│                                                      │
│  Powered by [HappyCapy Logo]  © 2026 BioMiND        │
└──────────────────────────────────────────────────────┘
```

- SIAT logo：下载自 SIAT 官网，保存至 `frontend/assets/siat-logo.png`
- HappyCapy logo：下载自 https://happycapy.ai，保存至 `frontend/assets/happycapy-logo.png`
- "Powered by HappyCapy" 文字链接目标：`https://happycapy.ai/?via=yves`（链接正常显示，不特意隐藏）
- 友情链接：前端启动时从 `/data/footer_config.json` fetch，渲染到页脚

---

## 6. 合并策略

### 合并顺序

1. **PR-0** → main（数据模型基础 + 页脚静态部分）
2. **admin-panel** → main（与其他两个无冲突，随时可合）
3. **sop-upload** → main
4. **sop-social** → main

### 已知冲突点

| 文件 | 冲突方 | 处置 |
|---|---|---|
| `backend/routers/sops.py` | sop-upload / sop-social | sop-social 在 sop-upload 合入后 rebase 再继续 |
| `backend/main.py` | sop-upload（StaticFiles 挂载 user-sops/） | 小改动，手动 merge |
| `frontend/assets/app.js` | 三方均有改动 | admin-panel 只填充 renderAdmin()；sop-upload 填充 renderShare()/renderSopDetail() 并在 renderSops() 末尾追加调用；sop-social 在 renderSopDetail() 末尾追加调用，互不覆盖 |
| `frontend/index.html` | 三方均有改动 | PR-0 建好占位符，各方只填充占位内 HTML |

---

## 7. 测试要求

- `tests/test_admin.py` — admin 端点权限（非管理员 → 403）、成员 CRUD、论文编辑、AI config 脱敏/PUT 语义、footer links CRUD
- `tests/test_sops.py` — 文件上传（PDF/docx/md）、大小限制（>20MB → 400）、MIME 校验、owner/admin 权限、硬删 vs 软下架
- `tests/test_social.py` — 点赞幂等（双击不增加计数）、收藏幂等、评论 CRUD、非登录用户 → 401
- 所有现有 74 个测试保持通过

---

## 8. 不在本次范围内

- SOP 全文搜索（BM25 索引暂不扩展到用户上传内容）
- 组内分享的富文本编辑器（使用现有 `_renderMd()` 渲染 Markdown）
- 用户个人主页
- 通知系统
- GET /api/sops 分页（本期返回全部，后续按需加）
