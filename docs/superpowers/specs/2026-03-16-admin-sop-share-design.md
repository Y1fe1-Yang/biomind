# BioMiND 扩展功能设计文档

**日期：** 2026-03-16
**范围：** 管理员面板 · 用户 SOP/分享上传 · SOP 社交功能
**开发策略：** 方案 B — 先合并数据模型 PR，再开三个并行 worktree

---

## 1. 总体架构

### 开发顺序

```
main
 └─ [PR-0] 数据模型基础（先合入）
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

```json
[
  {
    "id": "sop-alice-2026-03-pcr-protocol",
    "type": "sop",
    "title": { "zh": "PCR 操作规程", "en": "PCR Protocol" },
    "description": { "zh": "...", "en": "..." },
    "file": "user-sops/alice/1711234567890.pdf",
    "fileType": "pdf",
    "mdContent": "",
    "tags": ["PCR", "分子生物学"],
    "uploadedBy": "alice",
    "uploadedAt": 1711234567.0,
    "status": "active",
    "likeCount": 0,
    "bookmarkCount": 0,
    "commentCount": 0
  }
]
```

**type 字段：** `"sop"` | `"share"`
**fileType：** `"pdf"` | `"docx"` | `"md"`（md 类型时正文存 `mdContent`，`file` 为空）
**status：** `"active"` | `"removed"`（管理员下架，不硬删除）

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
- `config.py` 优先读此文件，读不到或字段为空则 fallback 到环境变量
- 管理员 GET 时 key 脱敏（只返回末尾 4 位）

### 2.4 成员数据 — 迁移到 `data/members.json`

`data/members.js`（`window.MEMBERS`）改为由 `data/members.json` 生成。
写入 `members.json` 后，后端自动重新生成 `members.js`。前端加载方式不变（`<script>` 标签）。

成员对象结构保持现有 `window.MEMBERS` 格式不变，仅将存储层由静态 JS 文件改为 JSON + API。

### 2.5 论文元数据编辑

`data/data.json` 中的可编辑字段：`title`、`authors`、`abstract`、`doi`、`directions`、`notes`。
写入后自动重新生成 `data/data.js`。PDF 文件本身不动。

---

## 3. API 设计

### 3.1 PR-0 — 数据模型基础（无新端点，仅迁移）

- 新建 `data/user-sops.json`（空数组）
- 新建 `data/ai_config.json`（从当前环境变量初始化）
- `data/users.db` 运行迁移脚本建社交三表
- `data/members.json` 从现有 `data/members.js` 提取数据生成
- `index.html` 加 `#view-admin`、`#view-share` 空占位
- `app.js` 路由表注册新视图，render 函数留空

### 3.2 Worktree: admin-panel

所有端点加 `Depends(admin_required)`。

```
GET    /api/admin/members              → 返回完整成员列表
POST   /api/admin/members              → 新增成员（写 members.json，重新生成 members.js）
PUT    /api/admin/members/{member_id}  → 编辑成员
DELETE /api/admin/members/{member_id}  → 删除成员

PUT    /api/admin/papers/{paper_id}    → 编辑论文元数据（写 data.json，重新生成 data.js）

GET    /api/admin/ai-config            → 读取 provider + 脱敏 key
PUT    /api/admin/ai-config            → 更新 provider 和/或 key（写 ai_config.json）

# 新闻管理复用现有端点（POST/PUT/DELETE /api/news/...），无需新增
```

新后端文件：
- `backend/routers/admin.py`
- `backend/services/members_store.py`
- `backend/services/ai_config_store.py`

### 3.3 Worktree: sop-upload

```
GET    /api/sops                       → 列出所有 active 内容（需登录）
                                         ?type=sop|share 可过滤
POST   /api/sops                       → 上传（multipart：file 或 mdContent + type + title + tags）
GET    /api/sops/{id}                  → 单篇详情
PUT    /api/sops/{id}                  → 编辑 title/description/tags（owner 或 admin）
DELETE /api/sops/{id}                  → 硬删除（owner 或 admin）
POST   /api/admin/sops/{id}/remove     → 管理员下架（status → removed）
```

文件存储：`data/user-sops/{username}/{timestamp}{ext}`，通过 `StaticFiles` 挂载到 `/data/user-sops/`。

新后端文件：`backend/routers/sops.py`、`backend/services/sop_store.py`

### 3.4 Worktree: sop-social

```
POST   /api/sops/{id}/like                    → 切换点赞，返回 {liked, count}
POST   /api/sops/{id}/bookmark                → 切换收藏，返回 {bookmarked, count}
GET    /api/sops/{id}/comments                → 评论列表（时间正序）
POST   /api/sops/{id}/comments                → 发评论（需登录）
DELETE /api/sops/{id}/comments/{comment_id}   → 删评论（owner 或 admin）
```

新后端文件：`backend/services/social_store.py`（SQLite 操作）
修改：`backend/routers/sops.py`（新增社交端点，故须在 sop-upload 合入后操作）

---

## 4. 前端架构

### 4.1 PR-0 在 app.js 中的改动

```javascript
// 路由表新增视图
const VIEW_AUTH_REQUIRED = ["sops", "share", "admin"];
const VIEW_ADMIN_REQUIRED = ["admin"];

// renderView dispatch 新增
case "admin":  renderAdmin();  break;
case "share":  renderShare();  break;

// 空占位函数（各 worktree 负责填充）
function renderAdmin()  { /* admin-panel worktree 负责 */ }
function renderShare()  { /* sop-upload worktree 负责 */ }
function renderSopDetail(id) { /* sop-upload worktree 负责 */ }
```

### 4.2 各 worktree 负责的前端范围

**admin-panel：**
- `#view-admin` 内部 HTML（选项卡式布局：成员 / 论文 / 新闻 / AI 配置）
- `renderAdmin()` 及其子函数

**sop-upload：**
- `#view-sops` 扩展（加入用户上传 SOP 列表）
- `#view-share` 内部 HTML
- `renderSops()`、`renderShare()`、`renderSopDetail()`
- 上传模态框

**sop-social：**
- SOP 详情页底部社交区块（点赞/收藏按钮 + 评论列表 + 评论输入框）
- 社交状态加载逻辑

### 4.3 UI/UX 一致性规范

三个 worktree 统一遵循以下 Tailwind 规范：

| 元素 | 类名 |
|---|---|
| 卡片容器 | `bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition` |
| 主操作按钮 | `bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700` |
| 次要按钮 | `border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm hover:bg-gray-50` |
| 危险按钮 | `text-red-600 hover:text-red-700 text-sm` |
| 表单输入框 | `border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500` |
| 模态框遮罩 | 复用现有 `auth-modal` 样式 |
| 标签/badge | `text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700` |
| 分区标题 | `text-lg font-bold text-gray-900 mb-4` |

---

## 5. 合并策略

### 合并顺序

1. **PR-0**（数据模型基础）→ main
2. **admin-panel** → main（与其他两个无冲突，随时可合）
3. **sop-upload** → main
4. **sop-social** → main（依赖 sop-upload 的 `routers/sops.py`）

### 已知冲突点

| 文件 | 冲突方 | 处置 |
|---|---|---|
| `backend/routers/sops.py` | sop-upload / sop-social | sop-social rebase 到 sop-upload 合入后再开发 |
| `backend/main.py` | sop-upload（StaticFiles 挂载） | 小改动，手动 merge |
| `frontend/assets/app.js` | 三方均有改动 | 各方只新增函数，不修改现有行，merge 时冲突极少 |
| `frontend/index.html` | 三方均有改动 | PR-0 已建好占位符，各方只填充占位内的 HTML |

---

## 6. 测试要求

- 每个 worktree 新增对应的 `tests/test_{module}.py`
- 所有现有 74 个测试保持通过
- 新测试覆盖：权限边界（非管理员无法调用 admin 端点）、文件类型校验、社交功能幂等性（重复点赞不增加计数）

---

## 7. 不在本次范围内

- SOP 全文搜索（BM25 索引暂不扩展到用户上传内容）
- 组内分享的富文本编辑器（用现有 Markdown 渲染即可）
- 用户个人主页
- 通知系统
