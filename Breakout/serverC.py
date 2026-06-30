import json
import os
from aiohttp import web

# Serve the client.html file
async def handle_index(request):
    # Assumes client.html is in the same folder as this script
    if os.path.exists('client.html'):
        return web.FileResponse('client.html')
    else:
        return web.Response(text="Error: client.html not found in this directory.", status=404)

# WebSocket handler to receive touch/mouse coordinates
async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    print("\n⚡ WebSocket connection established! Streaming incoming events...\n")

    async for msg in ws:
        if msg.type == web.WSMsgType.TEXT:
            try:
                # Parse the incoming JSON coordinate data
                data = json.loads(msg.data)
                event_type = data.get('event')
                x = data.get('x')
                y = data.get('y')
                
                # Print the coordinates cleanly in the server terminal
                print(f"[{event_type}] Target Position -> X: {x}, Y: {y}")
                
            except json.JSONDecodeError:
                print(f"Received raw text: {msg.data}")
                
        elif msg.type == web.WSMsgType.ERROR:
            print(f"WebSocket connection closed with exception {ws.exception()}")

    print("\n❌ WebSocket connection closed.\n")
    return ws

# Create the application and add routes
app = web.Application()
app.add_routes([
    web.get('/', handle_index),         # Main landing page serves client.html
    web.get('/ws', websocket_handler),  # WebSocket route
])

if __name__ == '__main__':
    print("Starting server on http://0.0.0.0:8080")
    web.run_app(app, host='0.0.0.0', port=8080)