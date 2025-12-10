"""Video Meeting Application - Entry Point."""

import asyncio
import signal
import sys

from server.app import start_server


async def main():
    """Main entry point for the video meeting server."""
    runner = await start_server(host="0.0.0.0", port=8080)

    # Handle shutdown gracefully
    stop_event = asyncio.Event()

    def handle_signal():
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, handle_signal)

    print("\nPress Ctrl+C to stop the server\n")

    try:
        await stop_event.wait()
    finally:
        print("\nShutting down server...")
        await runner.cleanup()
        print("Server stopped.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
