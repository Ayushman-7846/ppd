from starlette.responses import JSONResponse


class ResearchBodyLimit:
    def __init__(self, app, limit=1_048_576):
        self.app = app
        self.limit = limit

    async def __call__(self, scope, receive, send):
        if (scope["type"] != "http" or not scope["path"].startswith("/api/v1/")
                or scope["method"] not in ("POST", "PUT", "PATCH")):
            await self.app(scope, receive, send)
            return
        content_length = dict(scope["headers"]).get(b"content-length", b"")
        payload = bytearray()
        too_large = content_length.isdigit() and int(content_length) > self.limit
        while not too_large:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            part = message.get("body", b"")
            if len(payload) + len(part) > self.limit:
                too_large = True
                break
            payload.extend(part)
            if not message.get("more_body", False):
                break
        if too_large:
            response = JSONResponse({"error": {"code": "body_too_large", "message": "Research requests are limited to 1 MB."}}, 413)
            await response(scope, receive, send)
            return
        sent = False

        async def buffered():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": bytes(payload), "more_body": False}
            return await receive()

        await self.app(scope, buffered, send)
