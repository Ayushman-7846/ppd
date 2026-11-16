import json

import httpx
import pytest

from app import providers
from app.lab_schemas import Parameters


@pytest.mark.parametrize("provider,path", [
    ("openrouter", "/api/v1/chat/completions"),
    ("anthropic", "/v1/messages"),
    ("gemini", "/v1beta/models/model-qa:generateContent"),
    ("ollama", "/api/chat"),
])
def test_adapter_passes_prompt_and_normalizes_usage(monkeypatch, provider, path):
    requests = []
    payloads = {
        "openrouter": {"id": "o1", "model": "model-qa", "object": "chat.completion", "created": 1,
                       "choices": [{"index": 0, "message": {"role": "assistant", "content": "{}"}, "finish_reason": "stop"}],
                       "usage": {"prompt_tokens": 17, "completion_tokens": 9, "total_tokens": 26}},
        "anthropic": {"id": "a1", "type": "message", "role": "assistant", "model": "model-qa", "stop_reason": "end_turn",
                      "content": [{"type": "text", "text": "{}"}], "usage": {"input_tokens": 17, "output_tokens": 9}},
        "gemini": {"candidates": [{"content": {"role": "model", "parts": [{"text": "{}"}]}, "finishReason": "STOP"}],
                   "modelVersion": "model-qa", "usageMetadata": {"promptTokenCount": 17, "candidatesTokenCount": 9}},
        "ollama": {"model": "model-qa", "message": {"role": "assistant", "content": "{}"},
                   "done": True, "done_reason": "stop", "prompt_eval_count": 17, "eval_count": 9},
    }

    def reply(request):
        requests.append(request)
        return httpx.Response(200, json=payloads[provider])

    transport = httpx.MockTransport(reply)
    if provider == "openrouter":
        original = providers.openai.OpenAI
        monkeypatch.setattr(providers.openai, "OpenAI",
                            lambda **options: original(**options, http_client=httpx.Client(transport=transport)))
    elif provider == "anthropic":
        original = providers.anthropic.Anthropic
        monkeypatch.setattr(providers.anthropic, "Anthropic",
                            lambda **options: original(**options, http_client=httpx.Client(transport=transport)))
    elif provider == "gemini":
        original = providers.genai.Client

        def inject(http_options, **options):
            configured = http_options.model_copy(update={"httpx_client": httpx.Client(transport=transport)})
            return original(**options, http_options=configured)

        monkeypatch.setattr(providers.genai, "Client", inject)
    else:
        original = providers.ollama.Client
        monkeypatch.setattr(providers.ollama, "Client",
                            lambda **options: original(**options, transport=transport))

    response = providers.call_model(provider, "sdk-test-key", "model-qa", "Analyze one stimulus.",
                                    Parameters(max_output_tokens=250, timeout=3))
    assert response.generation.text == "{}"
    assert response.generation.input_tokens == 17 and response.generation.output_tokens == 9
    assert response.generation.reported_model == "model-qa"
    assert len(requests) == 1
    assert requests[0].url.path == path
    assert "Analyze one stimulus." in json.dumps(json.loads(requests[0].content))
