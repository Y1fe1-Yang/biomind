# BioMiND 实验室知识管理平台 — 设计文档

**日期**：2026-03-13
**状态**：已确认，待实现
**部署目标**：本地单机 → 局域网共享（两阶段）

---

## 1. 项目目标

为 BioMiND 课题组构建一个本地 Web 应用，作为实验室的知识记忆系统 + AI 科研助手，服务于后来加入的成员，让他们能够：

- 了解课题组历史上做过什么（论文时间线）
- 理解特定时期的研究方向和技术选择
- 查阅实验操作规程（SOP）
- 浏览组内分享的报告和 PPT
- 通过内嵌 AI 助手（Kimi）完成文献检索、综述撰写、SOP 起草、文件生成等科研任务

**核心约束**：
- `start.bat` / `start.sh` 一键启动，自动打开浏览器，用户体验完全是"打开网页"
- Kimi 作为浮动按钮内嵌于每个页面右下角，常驻可用
- `lab_qa` 技能通过架构级 RAG 管道严格限定在已有文献内容，不依赖 prompt 层面约束
- API Key 存储于 `.env` 文件（`.gitignore` 排除），不暴露给浏览器

---

## 2. 整体架构

### 目录结构

```
BioMiND-Site/
├── start.bat                       ← Windows 一键启动
├── start.sh                        ← Mac/Linux 一键启动
├── requirements.txt                ← Python 依赖列表
├── .env.example                    ← API Key 配置模板（提交到 git）
├── .env                            ← 实际 API Key（.gitignore 排除，不提交）
│
├── backend/
│   ├── main.py                     ← FastAPI 入口，挂载静态文件 + 路由
│   ├── config.py                   ← 从 .env 读取配置（端口、API Key 等）
│   ├── routers/
│   │   ├── kimi.py                 ← POST /api/chat，技能调用路由
│   │   ├── conversations.py        ← 对话管理（列表/创建/重命名/删除）
│   │   ├── files.py                ← GET /api/files/{path}（含路径遍历防护）
│   │   └── downloads.py            ← GET /api/download/{uuid_filename}
│   ├── services/
│   │   ├── kimi_client.py          ← Kimi API 封装（tool calling）
│   │   ├── rag.py                  ← RAG 检索引擎（BM25，见第 7 节）
│   │   ├── skill_executor.py       ← Tier 1/2/3 技能分发
│   │   ├── file_generator.py       ← docx / pptx / html 生成
│   │   └── conversation_store.py   ← 对话持久化（JSON 文件存储）
│   └── skills/
│       ├── lab_qa.py               ← RAG 约束问答
│       ├── literature_review.py
│       ├── scientific_writing.py
│       ├── hypothesis_generation.py
│       ├── peer_review.py
│       ├── sop_drafting.py
│       ├── pubmed_search.py
│       ├── citation_management.py
│       └── report_generation.py
│
├── frontend/
│   ├── index.html
│   ├── i18n/
│   │   ├── zh.js                   ← window.I18N_ZH（界面文本）
│   │   └── en.js                   ← window.I18N_EN
│   └── assets/
│       ├── app.js
│       └── style.css               ← 预编译 Tailwind CSS（随项目提交）
│
├── data/
│   ├── data.json                   ← 规范数据源（build.py 生成，backend 读取）
│   └── data.js                     ← 由 data.json 生成的前端版本（window.DATA）
│
├── files/
│   ├── papers/
│   ├── books/
│   ├── sops/
│   ├── presentations/
│   └── generated/                  ← Kimi 生成的文件（永久保存，按对话 ID 组织）
│
├── conversations/                  ← 持久化对话存储
│   └── {username}/
│       └── {conv_id}.json          ← 每个对话一个 JSON 文件
│
└── scripts/
    ├── build.py                    ← 扫描 files/ → 生成 data/data.json + data/data.js
    └── extract_meta.py             ← Kimi API 提取 PDF 元数据（可选，读 .env 获取 Key）
```

### 关键设计决策

**双数据文件策略**：
- `data/data.json` — 规范数据源，Python 后端直接读取（JSON，无需解析 JS）
- `data/data.js` — 由 `build.py` 从 `data.json` 自动生成，以 `window.DATA=...` 形式供前端 `<script>` 加载
- 两者始终同步，`data.json` 是唯一人工编辑目标

**API Key 管理**：
- 仅后端 `config.py` 通过 `python-dotenv` 读取 `.env`
- `build.py` 同样读取项目根目录的 `.env`（与 FastAPI 共享同一配置）
- `.env` 加入 `.gitignore`，`.env.example` 提交到 git 作为模板

### 数据流

```
浏览器 ←── FastAPI 静态服务 ──→ frontend/index.html
   │                                    │
   │  REST API                 <script> data/data.js
   ▼
FastAPI 后端
   ├── POST /api/chat          ← Kimi 对话（含技能调用）
   ├── GET  /api/files/{path}  ← 静态文件（PDF 等，路径遍历防护）
   └── GET  /api/download/{f}  ← UUID 命名的生成文件下载
         ▲
    Kimi API（月之暗面）
    外部 API（PubMed / OpenAlex / CrossRef）
    本地 RAG 检索（data/data.json → BM25 索引）
```

### 升级路径

| 阶段 | 服务端运行方式 | 客户端访问方式 |
|------|--------------|--------------|
| Phase 1（本机） | `start.bat` → `localhost:8080` | 自动打开浏览器 |
| Phase 2（局域网） | `start.bat`（改一行：`host=0.0.0.0`）→ `{LAN_IP}:8080` | 组内成员手动输入 `http://{LAN_IP}:8080` |
| Phase 3（代码执行） | 同上 + 沙箱服务 | 同上 |

> Phase 2 注意：局域网客户端直接在浏览器地址栏输入服务器 IP，不需要运行 `start.bat`。服务端 `start.bat` 仅在托管机器上运行一次即可。

---

## 3. 数据模型

`data/data.json` 是全站唯一规范数据源，由 `build.py` 生成，人工可补充 `notes`。

```json
{
  "meta": {
    "lab": "BioMiND",
    "generated": "2026-03-13T00:00:00Z",
    "directions": ["微流控", "光学检测", "细胞分析", "生物传感器"]
  },
  "papers": [
    {
      "id": "yang-analchem-2010",
      "type": "journal",
      "title": "...",
      "authors": ["Yang, Y.", "..."],
      "year": 2010,
      "journal": "Analytical Chemistry",
      "doi": "10.1021/...",
      "file": "files/papers/3.YangAnalChem2010.pdf",
      "directions": ["微流控", "生物传感器"],
      "abstract": "...",
      "notes": { "zh": "", "en": "" }
    }
  ],
  "books": [
    {
      "id": "book-online-pdf",
      "type": "book",
      "title": "...",
      "authors": ["..."],
      "year": 2020,
      "file": "files/books/10_Online PDF.pdf",
      "directions": [],
      "abstract": "",
      "notes": { "zh": "", "en": "" }
    }
  ],
  "sops": [
    {
      "id": "sop-droplet-generation",
      "title": "液滴生成操作规程",
      "version": "v2.1",
      "updated": "2025-01-10",
      "author": "张三",
      "file": "files/sops/droplet-generation-v2.1.pdf",
      "tags": ["微流控", "液滴"]
    }
  ],
  "presentations": [
    {
      "id": "pres-2024-0315-single-cell",
      "title": "单细胞检测新进展",
      "date": "2024-03-15",
      "author": "李四",
      "file": "files/presentations/2024-03-15-single-cell.pdf",
      "tags": ["细胞分析"],
      "summary": { "zh": "", "en": "" }
    }
  ]
}
```

### 字段说明

| 字段 | 适用类型 | 必填 | 说明 |
|------|---------|------|------|
| `id` | 全部 | 是 | build.py 从文件名推导（规则见下） |
| `type` | paper, book | 是 | `journal`/`conference`/`book`，从目录路径推断 |
| `doi` | paper | 否 | extract_meta.py 提取；生成 `https://doi.org/{doi}` 链接 |
| `directions` | paper, book | 否 | 从 `meta.directions` 选取，人工填写 |
| `notes` / `summary` | 全部 | 否 | 中英双语 `{ "zh": "...", "en": "..." }` |
| `author` | sop, presentation | 是 | 统一字段名 |
| `file` | 全部 | 是 | 相对于项目根的路径，通过 `/api/files/{path}` 访问 |

### ID 生成规则

1. 去掉数字前缀（如 `3.`、`14.`）
2. 去掉扩展名
3. 转小写，空格/特殊字符 → `-`
4. SOP：去掉版本号后缀（`-v2.1`），保持跨版本 ID 稳定

**`--rebuild` 冲突处理**：若同一 base ID 对应多个文件（如 SOP 的新旧版本），`--rebuild` 保留 `notes` 到最新文件对应的条目，旧版条目标记 `"archived": true` 保留在 `data.json` 中供历史查阅，但不在前端展示（前端过滤 `archived: true`）。

---

## 4. 前端界面

### 导航栏（顶部固定）

```
[BioMiND Logo]  时间线  研究方向  SOP库  组内分享  |  🔍  中/EN
```

右下角常驻 **Kimi 浮动按钮**（圆形，点击展开对话面板）。

### 视图一：时间线（`#timeline`）

- 按年份从新到旧，每年一个区块（不显示 `archived: true` 条目）
- 论文/书籍/SOP/PPT 混排，颜色区分：🔵期刊 🟢会议 📗书籍 🟡SOP 🟣分享
- 点击卡片展开：摘要、notes、DOI 按钮（`target="_blank"`）、PDF 链接

### 视图二：研究方向（`#directions`）

- 方向标签云，点击过滤，支持多标签叠加
- 展示论文和书籍卡片（标题、年份、期刊、作者、DOI）

### 视图三：SOP 库（`#sops`）

- 表格：名称 / 版本 / 更新日期 / 负责人 / 标签（仅显示最新版）
- 标签筛选 + 关键词搜索
- 点击以 `target="_blank"` 打开 PDF

### 视图四：组内分享（`#presentations`）

- 卡片网格，按日期倒序，标签筛选
- 点击以 `target="_blank"` 打开 PDF

### 全文搜索

- 客户端搜索，基于 `window.DATA`（标题 + 摘要 + tags）
- 结果跨四种内容类型，标注类型图标

### PDF 打开行为

统一使用 `<a href="/api/files/..." target="_blank">`，不嵌入 `<iframe>`。

---

## 5. i18n 方案

- 界面文字外置到 `frontend/i18n/zh.js`、`en.js`，以 `<script>` 加载
- 默认中文，偏好持久化 `localStorage`
- 论文标题、摘要、作者名保留英文原文
- `notes` / `summary` 支持 `{ "zh": "...", "en": "..." }`

---

## 6. 内容管理工作流

所有命令在 `BioMiND-Site/` 根目录执行。`build.py` 读取根目录 `.env` 获取 API Key（`--extract` 模式需要）。

### 添加新论文

1. PDF 放入 `files/papers/`
2. `python scripts/build.py` — 扫描新文件，生成基础条目到 `data/data.json`，同步生成 `data/data.js`
3. （可选）`python scripts/build.py --extract` — Kimi 提取标题/作者/摘要/DOI
4. 编辑 `data/data.json`，补填 `notes`（`build.py` 自动同步到 `data.js`，或手动再运行一次）
5. 刷新浏览器

### 添加 SOP

1. 文件放入 `files/sops/`，命名：`{主题}-v{版本}.pdf`
2. `python scripts/build.py`，补充 `author`、`tags`

### 更新 SOP 版本

1. 新版文件放入 `files/sops/`
2. `python scripts/build.py --rebuild`
3. 旧版自动标记 `archived: true`，`notes` 迁移到新版条目

### 添加组内分享

1. 文件放入 `files/presentations/`，命名：`{YYYY-MM-DD}-{主题}.pdf`
2. `python scripts/build.py`，补充 `author`、`tags`、`summary`

### build.py 模式

| 命令 | 行为 |
|------|------|
| `python scripts/build.py` | 扫描新文件，追加到 `data.json`，同步 `data.js` |
| `python scripts/build.py --extract` | 同上 + Kimi API 提取元数据（读 `.env`） |
| `python scripts/build.py --rebuild` | 重建全部索引，ID 匹配保留 `notes`，旧版 SOP 标记 `archived` |

---

## 7. Kimi AI 助手

### 界面形式

右下角浮动圆形按钮，点击展开侧边对话面板（宽 400px，高覆盖视口 80%）。面板顶部显示当前技能选择器。

### `/api/chat` 请求/响应 Schema

```json
// 请求
{
  "session_id": "uuid-v4",        // 由前端从 cookie 或 localStorage 获取
  "skill_id": "lab_qa",           // 见技能列表，null 表示通用对话
  "message": "...",               // 用户消息
  "context": {                    // 可选，前端传入当前浏览内容
    "paper_ids": ["yang-analchem-2010"]
  }
}

// 响应（流式 SSE）
{
  "type": "text",
  "content": "...",
  "sources": [                    // lab_qa 技能强制附带
    { "id": "yang-analchem-2010", "title": "...", "excerpt": "..." }
  ],
  "download_url": null            // 文件生成时返回 /api/download/{uuid}
}
```

### 用户识别

无登录机制，用户在首次访问时输入一个**用户名**（中英文均可），存入 `localStorage`。用户名作为 `conversations/` 下的目录名，隔离不同人的对话和文件。用户名可在设置中修改。

### 对话管理

每个对话对应 `conversations/{username}/{conv_id}.json`，结构如下：

```json
{
  "id": "uuid-v4",
  "name": "微流控文献综述 2026-03",
  "username": "张三",
  "skill_id": "literature_review",
  "created_at": "2026-03-13T10:00:00Z",
  "updated_at": "2026-03-13T11:30:00Z",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "...", "sources": [...] }
  ],
  "generated_files": [
    { "filename": "{uuid}.docx", "label": "综述草稿 v1", "created_at": "..." }
  ]
}
```

**对话操作**（通过 `conversations.py` 路由）：

| 操作 | API | 说明 |
|------|-----|------|
| 列出我的对话 | `GET /api/conversations` | 按 `updated_at` 倒序 |
| 新建对话 | `POST /api/conversations` | 默认名为"新对话 {日期}"，可立即重命名 |
| 重命名对话 | `PATCH /api/conversations/{id}` | 修改 `name` 字段 |
| 删除对话 | `DELETE /api/conversations/{id}` | 同时删除关联的生成文件 |
| 发送消息 | `POST /api/chat` | 消息追加到对话 JSON，SSE 流式响应 |

**Kimi 浮动面板**左侧显示当前用户的对话列表，支持切换、新建、重命名。

### 技能体系

技能定义参考两个仓库翻译为 Kimi tool calling 格式：
- [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills)
- [K-Dense-AI/claude-scientific-skills](https://github.com/K-Dense-AI/claude-scientific-skills/tree/main/scientific-skills)

> **兼容性说明**：上述 skill 仓库为 Claude 格式，需适配为 Kimi tool calling（OpenAI 兼容格式）。`skill_executor.py` 负责将 Kimi 的 tool call 请求分发到各技能实现。

#### Tier 1 — 文本生成技能（立即可用，所有响应基于 Kimi 生成）

| 技能 ID | RAG 约束 | 可生成文件 | 说明 |
|---------|---------|-----------|------|
| `lab_qa` | 是（硬性，见下） | — | 组内文献问答，严格引用来源 |
| `literature_review` | 是（限选定论文） | `.docx` | 生成综述段落 |
| `scientific_writing` | 否（开放生成） | `.docx` | 辅助写引言/方法/讨论 |
| `hypothesis_generation` | 是（基于组内文献） | `.docx` | 提出新假设 |
| `peer_review` | 否 | `.docx` | 审阅手稿 |
| `sop_drafting` | 是（基于现有 SOP） | `.docx` | 起草新协议 |
| `citation_management` | 否 | `.docx` | 引文格式化（APA/Vancouver 等） |
| `report_generation` | 否 | `.docx` / `.pptx` | 组会摘要或 PPT 大纲 |

#### Tier 2 — 外部 API 技能（需联网，失败时返回友好错误提示）

| 技能 ID | 说明 |
|---------|------|
| `pubmed_search` | 搜索 PubMed（NCBI E-utilities API，免费） |
| `openalex_search` | 学术论文广泛检索（OpenAlex API，免费） |
| `crossref_doi` | 根据标题/作者查询 DOI（CrossRef API，免费） |

Tier 2 错误处理：若外部 API 不可达，返回 `{ "type": "error", "message": "外部服务暂时不可用，请稍后再试" }`，不中断会话。

#### Tier 3 — 代码执行技能（Phase 3，暂缓）

| 技能 ID | 对应 skill | 说明 |
|---------|-----------|------|
| `data_visualization` | matplotlib / plotly | 生成图表（需沙箱） |
| `single_cell_analysis` | scanpy | 单细胞分析 |
| `stats_analysis` | statistical-analysis | 统计建模 |

### RAG 管道（`lab_qa` 及带 RAG 约束的技能）

架构级约束，不依赖 prompt 指令：

```
1. 服务启动时：
   data/data.json → PyPDF2 提取各论文/SOP 全文
                 → 分块（每块 ~500 字符，50 字符重叠）
                 → BM25 索引（rank-bm25 库）存入内存

2. 每次 lab_qa 请求：
   用户问题 → BM25 检索 Top-K 相关块（K=5）
            → 仅将这 K 个块注入 Kimi 上下文
            → Kimi 系统 prompt：
              "只能根据以下文献片段回答，不得引用外部知识。
               每条回答必须注明来源论文 ID。
               若片段中无相关信息，回答'现有文献中未找到相关内容'。"
            → Kimi 生成回答
            → 响应中附带 sources 列表（来自检索结果）

3. 约束执行保证：
   - Kimi 收到的上下文窗口中只有检索到的文献片段，无其他知识
   - sources 字段由后端从检索结果构造，不由 Kimi 生成
```

> **索引说明**：优先使用 `abstract` 字段；若 PDF 文本提取成功则使用全文。PDF 提取失败时（扫描版等）降级为 abstract-only，在响应中标注 `"index_type": "abstract_only"`。

### 文件生成

`file_generator.py` 生成文件，**全部使用 UUID 命名**防止枚举攻击，**永久保存**，不自动清理。

| 格式 | 库 | 说明 |
|------|---|------|
| `.docx` | `python-docx` | 主要文档格式，可用 Word/WPS 编辑 |
| `.pptx` | `python-pptx` | PPT 大纲 |
| `.xlsx` | `openpyxl` | 表格数据 |
| `.html` | Python 内置字符串模板 | 富文本输出，浏览器直接打开，内联 CSS 样式，无需额外库 |

生成文件保存路径：`files/generated/{username}/{conv_id}/{uuid}.{ext}`

- 按用户 + 对话分目录，便于管理
- 通过 `/api/download/{username}/{conv_id}/{uuid}.{ext}` 下载
- 文件记录在对话 JSON 的 `generated_files` 字段中，面板内可直接点击下载
- 删除对话时同步删除该对话目录下的所有生成文件

### 安全说明

**路径遍历防护**（`files.py`）：
```python
# 伪代码
safe_root = Path("files").resolve()
requested = (safe_root / path_param).resolve()
if not str(requested).startswith(str(safe_root)):
    raise HTTPException(403)
```

**生成文件枚举防护**：文件名为 UUID v4，不含任何可预测信息。

---

## 8. 技术选型汇总

| 层 | 技术 | 理由 |
|----|------|------|
| 后端框架 | FastAPI + uvicorn | 轻量异步，Python 生态，SSE 支持好 |
| 前端 | Vanilla JS | 零运行时依赖，无需构建 |
| 样式 | TailwindCSS（预编译） | CSS 随项目提交，不依赖 CDN |
| 数据规范源 | `data/data.json` | 后端直接读取，无需解析 JS |
| 数据前端源 | `data/data.js`（从 json 生成） | `window.DATA`，`<script>` 加载，无 fetch |
| 启动器 | `start.bat` / `start.sh` | 一键启动 + 打开浏览器 |
| LLM | Kimi API | 用户指定，OpenAI 兼容格式，中文支持好 |
| RAG 检索 | `rank-bm25`（BM25） | 纯 Python，无向量数据库依赖，Phase 1 足够 |
| 对话持久化 | JSON 文件（`conversations/`） | 零依赖，人类可读，重启不丢失 |
| 文件生成 | python-docx / python-pptx / openpyxl / HTML 模板 | 纯 Python，无系统级依赖 |

### Python 依赖（requirements.txt）

```
fastapi
uvicorn[standard]
python-dotenv
httpx
rank-bm25
PyPDF2
python-docx
python-pptx
openpyxl
```

---

## 9. 不在范围内（当前版本）

- 用户登录 / 权限管理（所有人可读）
- 在线编辑 `data.json`（文本编辑器手动维护）
- 自动同步云端（本地优先）
- 移动端优化（桌面浏览器为主）
- 书籍的专属视图（出现在时间线，不单独设视图）
- Tier 3 代码执行技能（scanpy / matplotlib 等）— Phase 3 单独规格
- Phase 3 向量语义搜索（BM25 够用，向量化待 Phase 2 完成后评估）
- HTTPS（局域网内部工具，不作要求）
- `.pdf` 格式输出（用 `.html` 替代，浏览器可直接打印为 PDF）
- 生成文件的自动清理（永久保存，用户手动管理）
