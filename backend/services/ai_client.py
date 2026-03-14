"""
AI provider abstraction.

Providers
---------
claude-code  Claude Code agent (Agent SDK) — default for local use.
             CC can read lab files, run scripts, write reports directly.
             Requires `claude` CLI installed and authenticated.

claude       Raw Anthropic API (claude-opus-4-6).
             Faster, no local CLI needed, good for cloud deployment.

kimi         Kimi API (OpenAI-compatible).
             Set AI_PROVIDER=kimi + KIMI_API_KEY in .env.

zhipu        ZhipuAI GLM API (OpenAI-compatible, glm-4-flash is free).
             Set AI_PROVIDER=zhipu + ZHIPU_API_KEY in .env.

Switch provider in .env:
    AI_PROVIDER=claude-code   # local, full tool access
    AI_PROVIDER=claude         # raw API, any environment
    AI_PROVIDER=kimi           # Kimi API
    AI_PROVIDER=zhipu          # ZhipuAI API (recommended for server deploy)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import AsyncIterator, Protocol

# Project root — passed to CC as cwd so it can read lab files
_ROOT = str(Path(__file__).parent.parent.parent)


class AIProvider(Protocol):
    """Minimal interface every AI backend must implement."""

    async def stream_chat(
        self,
        messages: list[dict],
        system: str = "",
    ) -> AsyncIterator[str]:
        """Yield text chunks as they arrive (SSE-ready)."""
        ...


# ---------------------------------------------------------------------------
# Claude Code Agent SDK provider  (AI_PROVIDER=claude-code)
# ---------------------------------------------------------------------------

class ClaudeCodeProvider:
    """Runs Claude Code as the AI agent.

    CC gets access to the BioMiND project directory — it can read papers,
    SOPs, and presentations directly, run the build script, and write
    generated files without any extra plumbing.

    Sandbox note: cwd is pinned to the project root; allowed_tools is
    restricted to read + search + bash + file write inside the project.
    """

    # Tools available to the lab assistant agent
    ALLOWED_TOOLS = [
        "Read",    # read any file inside cwd
        "Glob",    # find files by pattern
        "Grep",    # search file contents
        "Bash",    # run shell commands (scoped to project cwd)
        "Write",   # write generated output files
        "Edit",    # patch existing files
    ]

    def __init__(self, cwd: str = _ROOT) -> None:
        self._cwd = cwd

    async def stream_chat(
        self,
        messages: list[dict],
        system: str = "",
    ) -> AsyncIterator[str]:
        from claude_agent_sdk import (
            ClaudeSDKClient,
            ClaudeAgentOptions,
            AssistantMessage,
            TextBlock,
        )

        prompt = _build_cc_prompt(messages)

        # Strip CLAUDECODE so the subprocess is not blocked as a nested session
        import os
        clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        options = ClaudeAgentOptions(
            cwd=self._cwd,
            allowed_tools=self.ALLOWED_TOOLS,
            permission_mode="acceptEdits",
            system_prompt=system or None,
            env=clean_env,
        )

        async with ClaudeSDKClient(options=options) as client:
            await client.query(prompt)
            async for msg in client.receive_response():
                if isinstance(msg, AssistantMessage):
                    for block in msg.content:
                        if isinstance(block, TextBlock):
                            yield block.text


def _build_cc_prompt(messages: list[dict]) -> str:
    """Format conversation history into a single prompt for CC."""
    if len(messages) == 1:
        return messages[0]["content"]

    history_parts = []
    for m in messages[:-1]:
        tag = "User" if m["role"] == "user" else "Assistant"
        history_parts.append(f"{tag}: {m['content']}")

    return (
        "Previous conversation:\n"
        + "\n\n".join(history_parts)
        + "\n\n---\n\nCurrent question: "
        + messages[-1]["content"]
    )


# ---------------------------------------------------------------------------
# Raw Anthropic API provider  (AI_PROVIDER=claude)
# ---------------------------------------------------------------------------

class ClaudeProvider:
    MODEL = "claude-opus-4-6"

    def __init__(self, api_key: str) -> None:
        import anthropic
        self._client = anthropic.AsyncAnthropic(api_key=api_key)

    async def stream_chat(
        self,
        messages: list[dict],
        system: str = "",
    ) -> AsyncIterator[str]:
        kwargs: dict = dict(
            model=self.MODEL,
            max_tokens=4096,
            thinking={"type": "adaptive"},
            messages=messages,
        )
        if system:
            kwargs["system"] = system

        async with self._client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text


# ---------------------------------------------------------------------------
# Kimi provider  (AI_PROVIDER=kimi)
# ---------------------------------------------------------------------------

class KimiProvider:
    """Kimi provider.

    Supports two key formats:
      sk-kimi-...  Kimi's Anthropic-compatible API (use Anthropic SDK + custom base_url)
      sk-...       Standard OpenAI-compatible endpoint
    """

    BASE_URL = "https://api.moonshot.cn"   # Anthropic SDK appends /v1; OAI path uses /v1 explicitly
    MODEL    = "moonshot-v1-32k"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        self._is_anthropic_compat = False  # Kimi is OpenAI-compatible only

    async def stream_chat(
        self,
        messages: list[dict],
        system: str = "",
    ) -> AsyncIterator[str]:
        if self._is_anthropic_compat:
            async for chunk in self._stream_anthropic(messages, system):
                yield chunk
        else:
            async for chunk in self._stream_openai(messages, system):
                yield chunk

    async def _stream_anthropic(
        self, messages: list[dict], system: str
    ) -> AsyncIterator[str]:
        import anthropic
        client = anthropic.AsyncAnthropic(
            api_key=self._api_key, base_url=self.BASE_URL
        )
        kwargs: dict = dict(model=self.MODEL, max_tokens=4096, messages=messages)
        if system:
            kwargs["system"] = system
        async with client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text

    async def _stream_openai(
        self, messages: list[dict], system: str
    ) -> AsyncIterator[str]:
        import httpx
        full_messages = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        payload = {"model": self.MODEL, "messages": full_messages, "stream": True}
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST", f"{self.BASE_URL}/v1/chat/completions",
                headers=headers, json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0]["delta"].get("content", "")
                        if delta:
                            yield delta
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue



# ---------------------------------------------------------------------------
# ZhipuAI provider  (AI_PROVIDER=zhipu)
# ---------------------------------------------------------------------------

class ZhipuProvider:
    """ZhipuAI GLM provider (OpenAI-compatible).

    glm-4-flash is free with rate limits; suitable for lab assistant use.
    Base URL: https://open.bigmodel.cn/api/paas/v4
    """

    BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
    MODEL = "glm-4-flash"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def stream_chat(
        self,
        messages: list[dict],
        system: str = "",
    ) -> AsyncIterator[str]:
        import httpx
        full_messages = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        payload = {"model": self.MODEL, "messages": full_messages, "stream": True}
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST", f"{self.BASE_URL}/chat/completions",
                headers=headers, json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0]["delta"].get("content", "")
                        if delta:
                            yield delta
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def get_provider() -> ClaudeCodeProvider | ClaudeProvider | KimiProvider | ZhipuProvider:
    from backend.config import AI_PROVIDER, CLAUDE_API_KEY, KIMI_API_KEY, ZHIPU_API_KEY

    if AI_PROVIDER == "zhipu":
        return ZhipuProvider(api_key=ZHIPU_API_KEY)
    if AI_PROVIDER == "kimi":
        return KimiProvider(api_key=KIMI_API_KEY)
    if AI_PROVIDER == "claude":
        return ClaudeProvider(api_key=CLAUDE_API_KEY)
    # Default: claude-code (local)
    return ClaudeCodeProvider()
