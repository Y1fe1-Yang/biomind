# SOP 翻译与分类标准化 — 设计文档

**日期**：2026-03-14
**状态**：已确认，待实现

---

## 目标

1. 将所有英文字段的 SOP 翻译成中文（全字段：title、purpose、steps、materials、protocol_notes、subcategory）
2. 将所有 SOP 的 category 标准化为 4 个固定中文分类
3. 修改 `sop_service.py` 提示词，防止未来提取时再出现英文内容

---

## 背景

108 条 SOP 中有少数（约 10 条）内容为英文，主要来自摘要提取路径（`_PROMPT_ABSTRACT`）。
另有约 12 条 category 字段为英文（Review、Experimental Protocol 等），是 AI 提取时自由生成的。

**标准分类（固定 4 项）：**

| 标准分类 | 含义 |
|----------|------|
| 微流控器件 | 芯片制备、光刻、软刻蚀、封装 |
| 生物样本处理 | 细胞培养、外泌体分离、蛋白纯化 |
| 检测与表征 | 光学检测、电化学、质谱、成像 |
| 数据分析 | 数值仿真、统计分析、机器学习 |

**非标准分类映射：**

| 现有英文分类 | 映射到 |
|---|---|
| Review | 检测与表征 |
| Experimental Protocol | 微流控器件 |
| Technology & Methods | 微流控器件 |
| Detection & Analysis | 检测与表征 |
| Imaging Technology | 检测与表征 |
| Photonics & Optics | 检测与表征 |
| Proteomics & Mass Spectrometry | 检测与表征 |
| Biomaterials | 生物样本处理 |
| Drug Delivery & Therapeutics | 生物样本处理 |
| Separation & Isolation | 生物样本处理 |

---

## 架构

两个独立改动，可以分开执行：

```
A. 一次性批量处理（脚本）
   scripts/translate_sops.py
     ├── 找出英文内容的 SOP
     ├── 调用 claude CLI 翻译全字段
     ├── 标准化 category
     └── 写回 data.json，重生成 data.js

B. 防止复发（改提示词）
   backend/services/sop_service.py
     └── _PROMPT_FULL / _PROMPT_ABSTRACT 加强约束
```

---

## `scripts/translate_sops.py`

### 判断"需要翻译"的逻辑

检测以下任意字段中英文字符占比 > 50%：
- `title`
- `purpose`
- `steps`（join 成字符串）

### 翻译提示词

```
将以下实验室 SOP 条目的所有文本字段翻译成中文，保持所有数值参数（浓度、温度、时间、转速）原样不变。
category 必须从以下选项之一选择：微流控器件 / 生物样本处理 / 检测与表征 / 数据分析。
返回与输入相同结构的 JSON 对象，只翻译文本，不增减字段。

输入：
{sop_json}
```

### 执行流程

```python
for sop in data["sops"]:
    if _needs_translation(sop):
        translated = call_claude_cc(prompt.format(sop_json=...))
        sop.update(translated)
    sop["category"] = _normalize_category(sop["category"])

write data.json
generate_data_files()
```

### CLI 用法

```bash
python scripts/translate_sops.py           # 只翻译英文 SOP
python scripts/translate_sops.py --all     # 重新处理所有 SOP（重置 category）
python scripts/translate_sops.py --dry-run # 打印哪些 SOP 会被处理
```

---

## `backend/services/sop_service.py` 提示词改动

在 `_PROMPT_FULL` 和 `_PROMPT_ABSTRACT` 的"严格要求"部分追加：

```
- 所有字段必须使用中文（数值参数保留原文）
- category 只能从以下四项选一：微流控器件 / 生物样本处理 / 检测与表征 / 数据分析
```

---

## 测试要点

- 运行后 `data.json` 中所有 SOP 的 `category` 均为 4 个标准分类之一
- 运行后无 SOP 的 `title` 为纯英文
- `--dry-run` 正确列出需要处理的条目
- 现有 49 个测试通过（提示词改动不影响测试，测试用 mock）
- 翻译后数值参数（如 "300g 离心 10 min"）保持不变

---

## 不做的事

- 不翻译论文标题、摘要（保留英文原文）
- 不改前端代码（分类 tab 已经按 category 字段渲染，改数据即可）
- 不做多语言切换（SOP 只存中文版）
