"""
告警诊断 SSE 流端点 (Alert Diagnosis SSE Stream Endpoint)

为 Prometheus Bridge 诊断模式提供实时事件流。
无需认证，供公开 Demo 页面使用。

架构:
    Redis SUBSCRIBE "vigilops:alert:diagnosis"
        → SSE event: diagnosis {JSON}
        → Browser EventSource
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

from app.core.config import settings
from app.core.redis import get_redis

logger = logging.getLogger("vigilops.alert_stream")

router = APIRouter(prefix="/api/v1/demo", tags=["Demo"])

DIAGNOSIS_CHANNEL = "vigilops:alert:diagnosis"

_connection_count = 0
_connection_lock = asyncio.Lock()
_ip_connections: dict[str, int] = defaultdict(int)
_MAX_PER_IP = 5


async def _sse_generator(request: Request):
    """SSE async generator: subscribe to Redis and yield events."""
    global _connection_count
    client_ip = request.client.host if request.client else "unknown"
    pubsub = None

    try:
        # Send connected event
        now = datetime.now(timezone.utc).isoformat()
        yield f"event: connected\ndata: {json.dumps({'time': now})}\n\n"

        redis = await get_redis()
        pubsub = redis.pubsub()
        await pubsub.subscribe(DIAGNOSIS_CHANNEL)

        last_keepalive = time.monotonic()

        while True:
            if await request.is_disconnected():
                break

            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )

            if message and message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                yield f"event: diagnosis\ndata: {data}\n\n"
                last_keepalive = time.monotonic()
            elif time.monotonic() - last_keepalive >= 15.0:
                yield ": keepalive\n\n"
                last_keepalive = time.monotonic()

    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"SSE stream error for {client_ip}: {e}")
    finally:
        if pubsub:
            try:
                await pubsub.unsubscribe(DIAGNOSIS_CHANNEL)
                await pubsub.aclose()
            except Exception:
                pass
        async with _connection_lock:
            _connection_count -= 1
            _ip_connections[client_ip] = max(0, _ip_connections[client_ip] - 1)
            if _ip_connections[client_ip] == 0:
                _ip_connections.pop(client_ip, None)


@router.get("/alerts/stream")
async def stream_diagnoses(request: Request):
    """实时告警诊断 SSE 流 (Real-time Alert Diagnosis SSE Stream)

    无需认证。供 Demo 页面使用。
    """
    global _connection_count
    client_ip = request.client.host if request.client else "unknown"

    async with _connection_lock:
        if _connection_count >= settings.demo_sse_max_clients:
            return StreamingResponse(
                iter([json.dumps({"error": "Too many connections"})]),
                status_code=503,
                media_type="application/json",
            )
        if _ip_connections[client_ip] >= _MAX_PER_IP:
            return StreamingResponse(
                iter([json.dumps({"error": "Too many connections from this IP"})]),
                status_code=503,
                media_type="application/json",
            )
        _connection_count += 1
        _ip_connections[client_ip] += 1

    return StreamingResponse(
        _sse_generator(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )
