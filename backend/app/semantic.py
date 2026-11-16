import math

from fastapi import HTTPException
from ollama import Client

from .config import get_settings
from .providers import safe_provider_error


def normalized_embeddings(vectors, expected):
    if len(vectors) != expected or not vectors or not vectors[0]:
        raise ValueError("Unexpected embedding dimensions.")
    first = len(vectors[0])
    normalized = []
    for vector in vectors:
        if len(vector) != first or any(not math.isfinite(value) for value in vector):
            raise ValueError("Invalid embedding values.")
        length = math.hypot(*vector)
        if not math.isfinite(length) or length == 0:
            raise ValueError("An embedding has no usable magnitude.")
        normalized.append([value / length for value in vector])
    return normalized


def embedded_matrix(outputs):
    settings = get_settings()
    if not settings.semantic_model:
        raise HTTPException(422, "No semantic embedding model is configured.")
    if not 2 <= len(outputs) <= 5:
        raise HTTPException(422, "Select one matched group of two to five trials for semantic similarity.")
    entries = [(index, text) for index, text in enumerate(outputs) if text]
    if len(entries) < 2:
        raise HTTPException(422, "At least two trials must have stored text.")
    if any(len(text) > 16000 for _, text in entries):
        raise HTTPException(422, "One or more trial texts exceed the embedding input limit.")
    client = None
    try:
        client = Client(host=settings.ollama_host, timeout=25, trust_env=False)
        reply = client.embed(model=settings.semantic_model, input=[text for _, text in entries], truncate=False)
        vectors = normalized_embeddings(reply.embeddings, len(entries))
    except Exception as error:
        raise safe_provider_error(error) from None
    finally:
        if client is not None:
            client.close()
    size = len(outputs)
    matrix = [[None] * size for _ in range(size)]
    for (i, _), a in zip(entries, vectors):
        for (j, _), b in zip(entries, vectors):
            cosine = math.fsum(left * right for left, right in zip(a, b))
            matrix[i][j] = round(min(1.0, max(-1.0, cosine)), 6)
    return {"model": settings.semantic_model, "reported_model": reply.model, "dimensions": len(vectors[0]),
            "method": "cosine-v1", "n": len(entries), "matrix": matrix}
