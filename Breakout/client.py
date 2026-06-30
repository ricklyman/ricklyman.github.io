import asyncio
import websockets

# Function to send messages to the server
async def send_messages(websocket):
    while True:
        message = await asyncio.to_thread(input, "Enter message: ")
        await websocket.send(message)

# Function to receive messages from the server
async def receive_messages(websocket):
    async for message in websocket:
        print(f"Received: {message}")

# Function to handle the chat client
async def chat():
    async with websockets.connect('ws://localhost:12345') as websocket:
        await asyncio.gather(
            send_messages(websocket),
            receive_messages(websocket)
        )

# Run the client
if __name__ == "__main__":
    asyncio.run(chat())