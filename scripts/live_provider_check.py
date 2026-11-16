"""Run a small, opt-in live generation and judge check against a running LinguaLens API."""

import argparse
from getpass import getpass
from time import monotonic, sleep
from urllib.parse import urlsplit

import httpx


TASKS = ("ambiguity", "recursion", "movement", "phonology")
PROVIDERS = ("openai", "gemini", "anthropic", "openrouter", "ollama")


class VerificationError(Exception):
    pass


def request(client, http_method, route, **kwargs):
    response = client.request(http_method, f"/api/v1/{route}", **kwargs)
    try:
        result = response.json()
    except ValueError:
        raise VerificationError(f"{route} returned HTTP {response.status_code} without a JSON envelope.") from None
    if response.is_error:
        code = result.get("error", {}).get("code", "unexpected_error")
        raise VerificationError(f"{route} returned HTTP {response.status_code} ({code}).")
    return result["data"]


def await_result(client, route, seconds):
    deadline = monotonic() + seconds
    while monotonic() < deadline:
        value = request(client, "GET", route)
        if value["state"] not in ("pending", "running", "processing"):
            return value
        sleep(1)
    raise VerificationError(f"{route} did not settle within {seconds} seconds. Inspect the saved job before resubmitting.")


def verify(client, args):
    request(client, "POST", "auth/login", json={"email": args.email, "password": getpass("Test account password: ")})
    providers = {row["provider"]: row for row in request(client, "GET", "providers")}
    planned = {args.provider} | ({args.judge_provider} if args.judge_provider else set())
    if any(not providers[name]["configured"] or not providers[name]["enabled"] for name in planned):
        raise VerificationError("BLOCKED: Enable each chosen provider and configure its server or encrypted account credential.")
    for provider in sorted(planned):
        models = request(client, "POST", f"providers/{provider}/test")
        print(f"{provider}: catalog returned {len(models)} identifiers. Generation check pending.")
    if not args.execute:
        print("Catalog-only check complete. Pass --execute to queue the four live trials and optional judge.")
        return
    parameters = {"max_output_tokens": args.max_tokens, "timeout": args.timeout}
    scored_ids, failures = [], 0
    for task in TASKS:
        queued = request(client, "POST", f"linguistic/{task}", json={"dataset_id": f"builtin:{task}",
            "item_key": f"{task}-01", "selection": {"provider": args.provider, "model": args.model, "parameters": parameters}})
        row = await_result(client, f"responses/{queued['response_id']}", args.wait)
        execution = row["execution"]
        passed = (row["state"] == "completed" and bool(row["raw_output"]) and bool(row["parsed_output"])
                  and bool(row["prompt_rendered"]) and row["provider"] == args.provider and row["model"] == args.model
                  and all(execution["parameters"].get(key) == value for key, value in parameters.items())
                  and execution.get("latency_ms") is not None and execution.get("validation", {}).get("structure") == "valid")
        failures += not passed
        if passed:
            scored_ids.append(row["id"])
        print(f"{'PASS' if passed else 'FAIL'} {task}: response {row['id']}, state {row['state']}, "
              f"latency {execution.get('latency_ms')}, input/output tokens {execution.get('input_tokens')}/{execution.get('output_tokens')}.")
    if args.judge_provider and scored_ids:
        rubric = next(row for row in request(client, "GET", "evaluations/rubrics") if row["name"] == "Standard linguistic rubric")
        job = request(client, "POST", "evaluations/automated", json={"method": "judge", "rubric_id": rubric["id"],
            "response_ids": scored_ids[:1], "judge": {"provider": args.judge_provider, "model": args.judge_model,
            "parameters": parameters}})[0]
        row = await_result(client, f"evaluations/{job['id']}", args.wait)
        attempt = row["attempts"][0]
        passed = row["state"] in ("completed", "needs_human_review") and bool(attempt["raw_output"] and attempt["judge_prompt"])
        failures += not passed
        print(f"{'PASS' if passed else 'FAIL'} judge: assessment {row['id']}, state {row['state']}.")
    elif args.judge_provider:
        failures += 1
        print("BLOCKED judge: this check produced no validated live responses to assess.")
    if failures:
        raise VerificationError(f"{failures} live checks did not pass. Inspect the recorded IDs in the website.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--email", required=True)
    parser.add_argument("--provider", choices=PROVIDERS, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--judge-provider", choices=PROVIDERS)
    parser.add_argument("--judge-model")
    parser.add_argument("--max-tokens", type=int, default=2048)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--wait", type=int, default=90)
    parser.add_argument("--execute", action="store_true", help="Queue four bounded live trials and the optional judge; provider charges may apply.")
    args = parser.parse_args()
    url = urlsplit(args.base_url)
    if url.username or url.password or url.query or url.fragment or url.path not in ("", "/") or not (
        url.scheme == "https" or (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1"))
    ):
        parser.error("Use the HTTPS site origin or an HTTP loopback origin, without a path or credentials.")
    if bool(args.judge_provider) != bool(args.judge_model) or (args.provider, args.model) == (args.judge_provider, args.judge_model):
        parser.error("Supply both judge fields and choose a different model for the judge.")
    if not 128 <= args.max_tokens <= 4096 or not 2 <= args.timeout <= 30 or not 10 <= args.wait <= 180:
        parser.error("Use 128–4096 tokens, a 2–30 second provider timeout, and a 10–180 second polling deadline.")
    try:
        site = args.base_url.rstrip("/")
        with httpx.Client(base_url=site, headers={"Origin": site}, timeout=30, trust_env=False) as client:
            verify(client, args)
    except VerificationError as error:
        print(error)
        return 1
    except httpx.HTTPError:
        print("The LinguaLens server could not be reached. Check its address and health endpoints.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
