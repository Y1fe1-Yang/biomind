# Lab QA Chat Upgrade — 设计文档

**日期**：2026-03-14
**状态**：已确认，待实现

---

## 目标

把现有聊天从"通用 AI + 标题列表 RAG"升级为"实验室知识驱动问答"：

- 有相关文献/SOP → AI 基于实际内容回答，注明来源 ID
- 无相关文献/SOP → AI 照常回答，但加 `[通用建议，非实验室记录]` 声明
- 行为永远生效，不需要用户切换模式

---

## 架构

改动范围：仅 `backend/services/rag.py` 和 `backend/routers/chat.py`，无新文件。

```
用户消息
  → retrieve_with_content(query, top_k=5)   ← rag.py（新函数）
       ├── SOP 命中 → 附前 8 步（截断至 1500 字符）
       └── 论文/书籍命中 → 附摘要（截断至 600 字符）
  → _build_context(hits_with_content)        ← chat.py（升级）
       → 结构化上下文块（见格式）
  → AI 流式回答（附来源声明）
```

---

## `backend/services/rag.py` 改动

### 1. 索引加料（`_tokenise`）

在现有标题/标签基础上，把以下字段也加入 BM25 语料：
- `abstract`（论文/书籍）
- `steps` 文本（SOP，所有步骤 join 成字符串）
- `purpose`（SOP）

这样 BM25 能命中内容里的关键词，而不只是标题。

### 2. 新函数 `retrieve_with_content(query, top_k)`

基于现有 `retrieve()`，在返回结果上附加内容字段：

```python
def retrieve_with_content(query: str, top_k: int = 5) -> list[dict]:
    """
    Like retrieve(), but each hit includes a 'content' key with
    the actual text to pass to the AI (steps or abstract).
    """
```

返回结构（每条 hit 新增 `content` 字段）：

```python
{
    "id": "sop-micromachines2022-1",
    "title": "负磁泳微流控芯片制备",
    "type": "sop",
    "score": 4.2,
    "content": "1. PDMS 预聚体与交联剂 10:1 混合...\n2. 65°C 固化 2 小时..."
    # (前 8 步，截断到 1500 字符)
}
```

**内容截断规则：**
- SOP：`steps[:8]` join，超过 1500 字符截断
- 论文/书籍：`abstract[:600]`
- 总上下文预算：所有 hits 合计不超过 4000 字符，按 score 高低填满后截止

---

## `backend/routers/chat.py` 改动

### 1. `_build_context()` 升级

旧版：
```
Relevant lab resources:
- [sop] 负磁泳微流控芯片制备 (2022)
```

新版：
```
[SOP] 负磁泳微流控芯片制备 (sop-micromachines2022-1)
步骤摘要: 1. PDMS 预聚体与交联剂 10:1 混合，脱气 30 min...

[论文] Label-free separation of nanoscale particles (nanoscale2021)
摘要: 本文报道一种基于负磁泳原理的纳米颗粒无标记分选方法...
```

函数签名改为 `_build_context(hits: list[dict]) -> str`，`hits` 来自 `retrieve_with_content()`。

### 2. 系统提示新增规则

在现有 `SYSTEM_PROMPT` 末尾追加：

```
Rules:
1. When answering based on lab resources above, cite the source ID in parentheses,
   e.g. "(来源：sop-micromachines2022-1)".
2. When the lab resources do not contain relevant information, prefix your answer
   with "[通用建议，非实验室记录] " before responding with general knowledge.
3. Never fabricate lab data, protocol parameters, or paper conclusions.
```

### 3. `chat()` 路由改动

将 `hits = retrieve(...)` 改为 `hits = retrieve_with_content(...)`，其余逻辑不变。

---

## 数据流示例

**场景 A：有匹配 SOP**
```
用户：外泌体怎么分离？
→ BM25 命中：sop-materialstodaybio2023-6（差速超速离心法）
→ 上下文包含步骤：300g/2000g/10000g/100000g 四步离心参数
→ AI 回答带具体参数，末尾注明 (来源：sop-materialstodaybio2023-6)
```

**场景 B：无匹配**
```
用户：量子点有毒吗？
→ BM25 无命中（score=0）
→ 上下文为空
→ AI 回答：[通用建议，非实验室记录] 量子点毒性取决于...
```

---

## 测试要点

- `retrieve_with_content()` 返回的 SOP hit 包含 `content` 字段且非空
- `retrieve_with_content()` 总内容不超过 4000 字符
- `_build_context()` 输出包含 ID 引用
- 无命中时 `_build_context()` 返回空字符串（不崩溃）
- 现有 49 个测试全部通过

---

## 不做的事

- 不改 SSE 协议（不添加结构化 `sources` 字段）
- 不改前端 UI
- 不添加"技能选择器"下拉
- 不改对话存储格式
