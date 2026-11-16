from dataclasses import dataclass
from itertools import islice
import random
from time import monotonic, sleep

import anthropic
import httpx
import ollama
import openai
from cryptography.fernet import Fernet, InvalidToken
from google import genai
from google.genai import types as gemini

from .config import get_settings
from .lab_schemas import Parameters, ProviderInfo
from .models import ModelProvider


PROVIDERS = ("openai", "gemini", "anthropic", "openrouter", "ollama")
DEMO_MODEL = "lingualens-reference"
DEMO_BASELINE = "lingualens-baseline"
MISSING = "Provider not configured. Please add valid API credentials."


class ProviderError(Exception):
    def __init__(self, message, *, code="provider_error", status=502, retryable=False, retry_after=0):
        super().__init__(message)
        self.code = code
        self.status = status
        self.retryable = retryable
        self.retry_after = retry_after


@dataclass(frozen=True)
class Generation:
    text: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    reported_model: str | None = None
    finish_reason: str | None = None


@dataclass(frozen=True)
class TimedGeneration:
    generation: Generation
    latency_ms: int
    attempts: int


def cipher():
    setting = get_settings().credential_key
    if setting:
        try:
            return Fernet(setting.get_secret_value().encode())
        except (ValueError, UnicodeError):
            pass
    return None


def encrypt(value: str) -> str:
    encryption = cipher()
    if encryption is None:
        raise ProviderError("Set a valid CREDENTIAL_KEY on the server to store account credentials.",
                            status=422, code="credential_storage_unavailable")
    return encryption.encrypt(value.strip().encode()).decode()


def environment_key(provider):
    settings = get_settings()
    value = getattr(settings, f"{provider}_api_key", None) if settings.allow_shared_provider_keys else None
    return value.get_secret_value().strip() if value else ""


def provider_info(provider, record: ModelProvider | None, diagnostic=None) -> ProviderInfo:
    if provider == "ollama":
        source = "server"
    elif record and record.credential_ciphertext:
        source = "account"
    else:
        source = "environment" if environment_key(provider) else "none"
    return ProviderInfo(
        provider=provider, enabled=record.enabled if record else True,
        configured=(source != "none" and (source != "account" or cipher() is not None)),
        credential_source=source, accepts_credential=provider != "ollama",
        credential_storage=cipher() is not None and provider != "ollama",
        default_model=record.default_model if record else None,
        parameters=Parameters.model_validate(record.parameters) if record else Parameters(),
        capabilities=(['Model catalog', 'Text generation', 'Usage where reported'] +
                      (['Embeddings with a configured model'] if provider == 'ollama' else [])),
        diagnostic=diagnostic,
    )


def credential(provider, record: ModelProvider | None):
    info = provider_info(provider, record)
    if not info.enabled:
        raise ProviderError("Enable this provider in AI Model Configuration.", status=409, code="provider_disabled")
    if not info.configured:
        raise ProviderError(MISSING, status=422, code="provider_not_configured")
    if info.credential_source == "account":
        try:
            return cipher().decrypt(record.credential_ciphertext.encode()).decode()
        except (InvalidToken, ValueError):
            raise ProviderError("The stored credential could not be read. Replace it in settings.",
                                status=422, code="credential_unreadable") from None
    return environment_key(provider)


def effective_parameters(provider, model, defaults: Parameters, overrides: Parameters):
    merged = defaults.model_dump(exclude_none=True) | overrides.model_dump(exclude_none=True)
    result = Parameters.model_validate({"max_output_tokens": 4096, "timeout": 45} | merged)
    if provider == "openai" and (result.temperature is not None or result.top_p is not None):
        # Sampling controls are omitted for the reasoning models by default.
        if not model.startswith(("gpt-4", "gpt-3.5")):
            raise ProviderError("This OpenAI model selection requires default temperature and top-p.",
                                status=422, code="unsupported_parameter")
    if provider == "anthropic" and result.temperature is not None:
        if result.temperature > 1 or result.top_p is not None:
            raise ProviderError("For Claude use temperature at most 1 and set only one sampling control.",
                                status=422, code="unsupported_parameter")
    if provider == "demo":
        result = Parameters()
    return result


def _sampling(params):
    return {key: getattr(params, key) for key in ("temperature", "top_p") if getattr(params, key) is not None}


class OpenAIAdapter:
    def __init__(self, key, timeout, *, router=False):
        self.router = router
        base = "https://openrouter.ai/api/v1" if router else "https://api.openai.com/v1"
        self.client = openai.OpenAI(api_key=key, base_url=base, timeout=timeout, max_retries=0)

    def close(self):
        self.client.close()

    def models(self):
        return [entry.id for entry in islice(self.client.models.list(), 300)]

    def generate(self, model, prompt, params):
        if self.router:
            reply = self.client.chat.completions.create(
                model=model, messages=[{"role": "user", "content": prompt}],
                max_tokens=params.max_output_tokens, **_sampling(params),
            )
            choice = reply.choices[0] if reply.choices else None
            return Generation(
                choice.message.content or "" if choice else "",
                getattr(reply.usage, "prompt_tokens", None), getattr(reply.usage, "completion_tokens", None),
                reply.model, choice.finish_reason if choice else None,
            )
        reply = self.client.responses.create(
            model=model, input=prompt, max_output_tokens=params.max_output_tokens,
            store=False, **_sampling(params),
        )
        return Generation(reply.output_text, getattr(reply.usage, "input_tokens", None),
                          getattr(reply.usage, "output_tokens", None), reply.model, reply.status)


class AnthropicAdapter:
    def __init__(self, key, timeout):
        self.client = anthropic.Anthropic(api_key=key, base_url="https://api.anthropic.com", timeout=timeout, max_retries=0)

    def close(self):
        self.client.close()

    def models(self):
        return [entry.id for entry in islice(self.client.models.list(), 300)]

    def generate(self, model, prompt, params):
        reply = self.client.messages.create(
            model=model, messages=[{"role": "user", "content": prompt}],
            max_tokens=params.max_output_tokens, **_sampling(params),
        )
        return Generation("".join(block.text for block in reply.content if block.type == "text"),
                          reply.usage.input_tokens, reply.usage.output_tokens, reply.model, reply.stop_reason)


class GeminiAdapter:
    def __init__(self, key, timeout):
        options = gemini.HttpOptions(timeout=int(timeout * 1000), retry_options=gemini.HttpRetryOptions(attempts=1))
        self.client = genai.Client(api_key=key, vertexai=False, http_options=options)

    def close(self):
        self.client.close()

    def models(self):
        models = islice(self.client.models.list(), 300)
        return [entry.name.removeprefix("models/") for entry in models
                if entry.name and "generateContent" in (entry.supported_actions or [])]

    def generate(self, model, prompt, params):
        reply = self.client.models.generate_content(
            model=model, contents=prompt,
            config=gemini.GenerateContentConfig(max_output_tokens=params.max_output_tokens, **_sampling(params)),
        )
        usage = reply.usage_metadata
        reason = reply.candidates[0].finish_reason if reply.candidates else None
        return Generation(reply.text or "", getattr(usage, "prompt_token_count", None),
                          getattr(usage, "candidates_token_count", None), reply.model_version, str(reason) if reason else None)


class OllamaAdapter:
    def __init__(self, _key, timeout):
        self.client = ollama.Client(host=get_settings().ollama_host, timeout=timeout, trust_env=False)

    def close(self):
        self.client.close()

    def models(self):
        return [entry.model for entry in self.client.list().models if entry.model]

    def generate(self, model, prompt, params):
        reply = self.client.chat(
            model=model, messages=[{"role": "user", "content": prompt}],
            options={"num_predict": params.max_output_tokens, **_sampling(params)}, format="json",
        )
        return Generation(reply.message.content or "", reply.prompt_eval_count, reply.eval_count, reply.model, reply.done_reason)


def adapter_for(provider, key, timeout):
    if provider == "openrouter":
        return OpenAIAdapter(key, timeout, router=True)
    return {"openai": OpenAIAdapter, "anthropic": AnthropicAdapter,
            "gemini": GeminiAdapter, "ollama": OllamaAdapter}[provider](key, timeout)


def safe_provider_error(error) -> ProviderError:
    code = getattr(error, "status_code", None) or getattr(error, "code", None)
    if isinstance(error, (httpx.TimeoutException, TimeoutError, openai.APITimeoutError,
                          anthropic.APITimeoutError)) or code == 408:
        return ProviderError("The provider did not respond before the request timeout.", code="provider_timeout",
                             status=504, retryable=True)
    if code in (401, 403):
        return ProviderError("The provider rejected the credentials or access to this model.", code="provider_access")
    if code == 404:
        return ProviderError("The provider could not find the selected model or endpoint.", code="model_unavailable")
    if code in (400, 422):
        return ProviderError("The provider rejected the request. Check model capabilities and parameters.",
                             code="provider_request_rejected")
    if code == 429:
        headers = getattr(getattr(error, "response", None), "headers", {})
        try:
            retry_after = max(0, float(headers.get("retry-after", 0)))
        except (TypeError, ValueError):
            retry_after = 0
        return ProviderError("The provider rate limit or quota has been reached.",
                             code="provider_rate_limit", status=429, retryable=True, retry_after=retry_after)
    if (isinstance(code, int) and 500 <= code <= 599) or isinstance(
        error, (httpx.TransportError, ConnectionError, openai.APIConnectionError, anthropic.APIConnectionError)
    ):
        return ProviderError("The provider is unavailable. Check its service or the Ollama server.",
                             code="provider_unavailable", retryable=True)
    return ProviderError("The provider returned an unexpected response.", code="provider_response")


def call_model(provider, key, model, prompt, params, cancelled=lambda: False):
    start = monotonic()
    for attempt in range(1, 4):
        if cancelled():
            raise ProviderError("Execution was cancelled.", status=409, code="cancelled")
        adapter = None
        try:
            adapter = adapter_for(provider, key, params.timeout)
            response = adapter.generate(model, prompt, params)
            return TimedGeneration(response, round((monotonic() - start) * 1000), attempt)
        except Exception as error:
            failure = safe_provider_error(error)
            if not failure.retryable or attempt == 3 or failure.retry_after > 8:
                failure.latency_ms = round((monotonic() - start) * 1000)
                failure.attempts = attempt
                raise failure from None
            sleep(max(failure.retry_after, (2 ** (attempt - 1)) * 0.5 + random.uniform(0, 0.25)))
        finally:
            if adapter:
                adapter.close()


def discover(provider, key):
    adapter = None
    try:
        adapter = adapter_for(provider, key, 8)
        return sorted(set(adapter.models()))[:300]
    except Exception as error:
        raise safe_provider_error(error) from None
    finally:
        if adapter:
            adapter.close()
