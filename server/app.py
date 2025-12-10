"""aiohttp application setup for the video meeting server."""

import os
from pathlib import Path

from aiohttp import web

from .signaling import websocket_handler


def create_app() -> web.Application:
    """Create and configure the aiohttp application."""
    app = web.Application()

    # Get the static files directory
    project_root = Path(__file__).parent.parent
    static_dir = project_root / "static"

    # Routes
    app.router.add_get("/ws", websocket_handler)
    
    # Serve index.html at root
    async def index_handler(request: web.Request) -> web.FileResponse:
        return web.FileResponse(static_dir / "index.html")
    
    app.router.add_get("/", index_handler)
    
    # Serve static files
    app.router.add_static("/static/", path=static_dir, name="static")

    return app


async def start_server(host: str = "0.0.0.0", port: int = 8080):
    """Start the web server."""
    app = create_app()
    runner = web.AppRunner(app)
    await runner.setup()
    
    site = web.TCPSite(runner, host, port)
    await site.start()
    
    print(f"Server started at http://localhost:{port}")
    print(f"Open this URL in your browser to join the meeting")
    
    return runner

