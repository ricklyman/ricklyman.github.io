import asyncio
from websockets.asyncio.server import serve

async def echo_handler(websocket):
    """Handles the lifecycle of a single WebSocket connection."""
    print(f"Client connected: {websocket.remote_address}")
    try:
        # Keep listening to the client until they disconnect
        async for message in websocket:
            print(f"Received from browser: {message}")
            
            # Send a reply back to the browser
            reply = f"Server received: '{message}'"
            await websocket.send(reply)
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        print(f"Client disconnected: {websocket.remote_address}")

async def main():
    # Start the server on localhost port 8765
    async with serve(echo_handler, "localhost", 8765):
        print("WebSocket server running on ws://localhost:8765")
        await asyncio.get_running_loop().create_future() # Run forever

if __name__ == "__main__":
    asyncio.run(main())
