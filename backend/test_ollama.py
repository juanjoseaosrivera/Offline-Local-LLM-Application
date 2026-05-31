import asyncio
import httpx

async def test_ollama():
    url = "http://localhost:11434/api/chat"
    payload = {
        "model": "llama3.2",
        "messages": [
            {"role": "user", "content": "Say hello in exactly 5 words."}
        ],
        "stream": False
    }
    
    print("Connecting to Ollama...")
    try:
        # Using HTTPX async client to query local Ollama server
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=payload)
            if response.status_code == 200:
                data = response.json()
                print("\n✅ Connectivity success!")
                print("Ollama Response:")
                print(f"'{data['message']['content']}'")
            else:
                print(f"\n❌ Error: Status code {response.status_code}")
                print(response.text)
    except Exception as e:
        print(f"\n❌ Failed to connect to Ollama. Is the Ollama app running?")
        print(f"Detail: {e}")

if __name__ == "__main__":
    asyncio.run(test_ollama())
