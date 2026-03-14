# BioMiND SOP 库自动提取 — 设计文档

**日期**：2026-03-14
**状态**：已确认，待实现（v3，post-review）

---

## 1. 目标

从实验室现有论文 PDF 的 Methods 章节自动提取实验协议，生成结构化 SOP 条目，填充 SOP 库。全程无需人工审核。

**核心约束**：
- 步骤必须完整还原原文协议，禁止合并或省略任何操作
- 所有数值参数（浓度、温度、时间、转速、体积）必须原文保留
- 格式统一，所有 SOP 遵循同一模板

---

## 2. 数据模型

### 2.1 auto 类型 SOP 条目

存入 `data/data.json` → `sops[]`，与现有文件型 SOP 共用同一数组：

```json
{
  "id": "sop-labchip2022-1",
  "title": "PDMS 微流控芯片制备",
  "category": "微流控器件",
  "subcategory": "芯片制备",
  "version": "v1.0",
  "source_paper_id": "labchip2022",
  "source_doi": "10.1039/d2lc00386h",
  "responsible": "Lin Zeng",
  "updated": "2022",
  "tags": ["PDMS", "光刻", "软刻蚀", "微流控"],
  "status": "auto",
  "purpose": "制备用于细胞分离实验的 PDMS 微流控芯片",
  "materials": ["SU-8 2100 光刻胶", "PDMS（Sylgard 184）", "固化剂", "硅片"],
  "steps": [
    "1. 将 SU-8 2100 以 500 rpm 旋涂至硅片，持续 10 s，再以 3000 rpm 旋涂 30 s",
    "2. 在 95°C 热板软烘烤 20 min",
    "3. ..."
  ],
  "notes": ["旋涂转速直接影响膜厚，500/3000 rpm 对应约 180 μm"],
  "reference": "Zeng et al., Lab on a Chip, 2022, DOI: 10.1039/d2lc00386h"
}
```

### 2.2 与现有文件型 SOP 的共存规则

现有文件型 SOP 格式（`scripts/build.py` 扫描 `files/sops/` 生成）：
```json
{ "id": "...", "title": "...", "version": "...", "updated": "...",
  "author": "...", "file": "...", "tags": [...] }
```

差异处理：

| 字段 | 文件型 SOP | auto SOP | 前端读法 |
|------|-----------|----------|---------|
| 负责人 | `author` | `responsible` | `s.responsible \|\| s.author \|\| ''` |
| 分类 | 无 | `category` / `subcategory` | 无分类的归入"全部"标签页，不进入分类筛选 |
| 详情 | 无（点击开 PDF） | `purpose/materials/steps/notes` | 有 `steps` 则展开卡片，否则展示 PDF 链接 |
| `notes` | 不存在 | `notes: [...]`（字符串数组） | `build.py` 的 `merge_notes()` 只处理 `{"zh":"","en":""}` 格式，auto SOP 的 `notes` 字段命名改为 `protocol_notes` 以避免冲突 |

> **修正**：auto SOP 使用 `protocol_notes`（字符串数组），文件型 SOP 的 `notes` 保持 `{"zh":"","en":""}` 格式，互不冲突。

### 2.3 ID 生成规则

auto SOP ID 格式：`sop-{source_paper_id}-{n}`

- `n` 从 1 开始，同一篇论文提取多条时递增
- 示例：`sop-labchip2022-1`、`sop-labchip2022-2`

### 2.4 `source_doi` 处理

`source_doi` 从对应 paper 条目的 `doi` 字段复制（不从 PDF 重新提取），确保与已有数据一致。

### 2.5 `updated` 字段格式

统一为年份字符串，如 `"2022"`，与文件型 SOP 的 `updated`（日期字符串）不同但可共存，前端仅展示不做日期计算。

---

## 3. 分类体系

```
微流控器件
  ├── 芯片制备（光刻、PDMS 浇注、键合）
  └── 流道组装与测试

生物样本处理
  ├── 细胞培养与收集
  ├── 胞外囊泡 (EV) 提取与纯化
  └── 核酸提取

检测与表征
  ├── 光学检测（SPR、LSPR、散射、荧光）
  ├── 电化学检测
  └── 显微成像

数据分析
  └── 信号处理与统计
```

文件型 SOP（无 `category`）不参与分类筛选，仅在"全部"标签页可见。

---

## 4. 提取管道（`scripts/extract_sops.py`）

### 4.1 批量模式

```
python scripts/extract_sops.py [--force]
```

1. 读 `data/data.json` → 取所有未 archived 的 papers
2. 跳过已有 `source_paper_id` 对应 auto SOP 条目的论文（除非 `--force`）
3. 对每篇：
   - a. PyMuPDF 提取全文
   - b. 正则定位 Methods 段落（标题关键词：`Methods`/`Materials and Methods`/`Experimental`/`实验方法`/`方法`/`Experimental Section`），取到下一节标题之间的文本
   - c. 若提取文本 < 200 字符（扫描版或失败）：
     - 有 DOI → CrossRef API 获取摘要作补充，但标记 `status: "abstract-only"`，**不生成 steps**，prompt 改为仅提取 `title/category/subcategory/tags/purpose`
     - 无 DOI → 跳过，记录 warning
   - d. 文本上限：8000 字符（截断，不分段）。Methods 章节极少超过 8000 字符；超出时取前 8000 字符并在 `protocol_notes` 中标注"Methods 文本已截断"
   - e. 调用 Claude API（`claude-sonnet-4-6`）：使用 `ClaudeProvider.stream_chat()`（异步生成器），在批量脚本中通过 `asyncio.run()` 驱动并收集所有 chunk 拼接为完整字符串，再解析 JSON。不使用假设中的 `chat()` 方法（该方法不存在）
   - f. 解析返回 → 生成 ID（`sop-{paper_id}-{n}`）→ 填充 `source_paper_id/source_doi/reference` → 追加到 `sops[]`
4. 写回 `data/data.json`，然后直接调用 `generate_data_files(root, rebuild=False)`（Python import，不启动子进程）同步生成 `data.js`

> **build.py 安全**：`--rebuild` 只重建 papers/books/presentations，不清空 auto SOP 条目（`status: "auto"` 的条目在 rebuild 时保留）。`build.py` 需增加此保护逻辑。

### 4.2 单篇按需模式（`POST /api/extract-sop`）

**Auth**：需要 JWT，且 `user.is_admin == True`（仅管理员可触发，防止任意用户消耗 API）。

> **部署注意**：`deps.py` 解码 token 时通过 `payload.get("is_admin", False)` 读取该声明。在本功能上线前已登录的用户（token 中不含 `is_admin` 字段）将被视为非管理员，需重新登录以获取含该声明的新 token。

**请求**：`{ "paper_id": "labchip2022" }`

**SSE 事件流**：

```
data: {"type": "progress", "status": "extracting", "message": "正在提取 PDF 文本..."}
data: {"type": "progress", "status": "ai_processing", "message": "AI 分析中..."}
data: {"type": "done", "sop_ids": ["sop-labchip2022-1"]}
data: {"type": "error", "message": "PDF 文本提取失败：文件不存在"}
```

执行同批量模式步骤 3a-3f，完成后：
1. 写入 `data.json`
2. 调用 `generate_data_files(root, rebuild=False)`（**直接 Python import 调用，不启动子进程**，避免阻塞 FastAPI 事件循环；用 `asyncio.get_event_loop().run_in_executor(None, generate_data_files, root, False)` 放入线程池）
3. 发送 SSE `done` 事件

**前端刷新**：SSE `done` 事件触发 `window.location.reload()` 以重新加载 `data.js`（`<script>` 标签方式加载，无法热更新）。

### 4.3 Prompt（完整文本提取模式）

```
你是实验室 SOP 整理助手。从以下论文 Methods 章节提取完整实验协议。

严格要求：
- steps 字段必须完整还原原文每一步，禁止合并或省略任何操作
- 所有数值参数（浓度、温度、时间、转速、体积、功率）必须原文保留
- 若原文包含多个独立 protocol，分别生成多个对象（返回 JSON 数组）
- 不得用"按常规操作"等模糊表述替代具体步骤
- materials 列出所有试剂和仪器（含型号/货号如有）

返回格式：JSON 数组，每个元素包含以下字段：
  title (string)          - 简明描述该操作，如"PDMS 芯片制备"
  category (string)       - 从以下四项选一：微流控器件/生物样本处理/检测与表征/数据分析
  subcategory (string)    - 自行细化
  purpose (string)        - 1-2 句说明该操作的目的
  materials (list)        - 所有试剂和仪器
  steps (list)            - 编号步骤，完整原文
  protocol_notes (list)   - 安全提示、关键参数、注意事项
  tags (list)             - 关键词
  responsible (string)    - 第一作者姓名

论文信息：
  标题：{title}
  作者：{authors}
  年份：{year}
  期刊：{journal}

Methods 文本：
{methods_text}
```

### 4.4 Prompt（摘要补充模式，`status: "abstract-only"`）

```
从以下论文摘要提取基本信息（无完整 Methods 文本）。
仅填充 title/category/subcategory/tags/purpose，steps/materials 留空列表。
返回格式：单个 JSON 对象（非数组）。

论文信息：...
摘要：{abstract_text}
```

---

## 5. `build.py` 修改

在 `--rebuild` 逻辑中增加保护（文件型 SOP 在前，auto SOP 追加在后）：

```python
# 重建时保留 auto SOP 条目（追加在文件型 SOP 之后）
auto_sops = [s for s in old_data.get("sops", []) if s.get("status") == "auto"]
new_data["sops"] = new_file_sops + auto_sops  # 文件型在前，auto 在后
```

注：`archive_old_sop_versions()` 在此合并之前运行，仅操作 `new_file_sops`，不影响 auto SOP。

---

## 6. 前端改动

### 6.1 SOP 库视图（`#sops`）重写 `renderSops()`

**筛选栏**：
- 顶层 category 标签页：全部 / 微流控器件 / 生物样本处理 / 检测与表征 / 数据分析
- 二级 subcategory 标签（动态从有 `category` 的 SOP 生成）
- 关键词搜索（搜索 title + tags + purpose）

**SOP 卡片（折叠）**：
```
📋 {title}                         [{category} > {subcategory}]（auto SOP）
   {title}                         [文件 SOP]（无分类 badge）
负责人：{responsible || author} · 来源：{journal} {year} · {version}
标签：{tags}                                                  [展开 ▼]
```

**SOP 卡片（展开）**：
- 有 `steps`（auto SOP）：展示 purpose / materials / steps / protocol_notes / reference
- 有 `file`（文件型 SOP）：展示 PDF 链接按钮

### 6.2 论文卡片新增「提取 SOP」按钮

**Admin 可见性机制**：登录成功后，`auth.js` 将 `window.__isAdmin = true/false` 写入全局（从 `/api/auth/me` 响应中读取 `is_admin` 字段）。`paperCard()` 在生成 HTML 时检查 `window.__isAdmin`，决定是否渲染提取按钮的 HTML。

- 仅对 `window.__isAdmin === true` 的用户渲染按钮
- 若该 `paper_id` 已有 auto SOP（检查 `window.DATA.sops`）：渲染「查看 SOP →」按钮（`data-action="view-sop"`）
- 若无：渲染「📋 提取 SOP」按钮（`data-action="extract-sop" data-paper-id="{id}"`）
  - 点击通过**事件委托**捕获（在 `#view-timeline` 上监听 `click`，过滤 `data-action="extract-sop"`）
  - 触发 `POST /api/extract-sop` with `Authorization: Bearer {token}` header
  - inline 替换按钮文字为进度提示，完成后 `window.location.reload()`
  - 错误时 inline 展示错误文字

事件委托绑定在 `renderTimeline()` 完成后执行一次（非每次 render 重绑）。

### 6.3 i18n 扩展（`sop` 命名空间，已存在）

`zh.js` / `en.js` 的 `sop` 对象新增以下 key：

```javascript
sop: {
  // 现有 key 保留...
  categoryAll: "全部",
  catMicrofluidics: "微流控器件",
  catBioSample: "生物样本处理",
  catDetection: "检测与表征",
  catDataAnalysis: "数据分析",
  btnExtract: "📋 提取 SOP",
  btnViewSop: "查看 SOP →",
  progressExtracting: "正在提取 PDF 文本...",
  progressAI: "AI 分析中...",
  progressDone: "提取完成，刷新中...",
  progressError: "提取失败：",
  fieldPurpose: "目的",
  fieldMaterials: "所需材料",
  fieldSteps: "操作步骤",
  fieldNotes: "注意事项",
  fieldSource: "来源论文",
  fieldResponsible: "负责人",
  statusAutoLabel: "AI 提取",
  statusAbstractOnly: "仅摘要",
}
```

---

## 7. 文件改动清单

| 文件 | 改动 |
|------|------|
| `scripts/extract_sops.py` | 新建：批量提取脚本 |
| `scripts/build.py` | `--rebuild` 保留 auto SOP；新建 `sop_id_exists()` 辅助函数 |
| `backend/routers/sop_extract.py` | 新建：`POST /api/extract-sop` SSE 路由（admin 鉴权） |
| `backend/main.py` | 注册 `sop_extract` 路由 |
| `data/data.json` | 填充 `sops[]`（by extract_sops.py） |
| `frontend/assets/app.js` | 重写 `renderSops()`；`paperCard()` 增加事件委托逻辑 |
| `frontend/i18n/zh.js` / `en.js` | 扩展 `sop` 命名空间 |
| `frontend/assets/input.css` | SOP 卡片展开样式（需重新编译 `style.css`） |

---

## 8. 不在范围内

- 人工审核流（全自动）
- SOP 在线编辑
- SOP PDF 导出
- 版本历史管理
- 文件型 SOP 的分类标注（单独任务）
- Haiku 模型降级（优先质量，用 sonnet）
