require('dotenv').config();

async function testChat() {
    const question = "any event today?";
    const eventsContext = "No events found.";
    const SYSTEM_PROMPT = "You are a helpful assistant.";

    try {
        const response = await fetch('https://api.edenai.run/v2/text/chat', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                providers: 'openai',
                text: question,
                chatbot_global_action: SYSTEM_PROMPT.replace('{eventsContext}', eventsContext),
                temperature: 0.2,
                max_tokens: 1000,
                openai: 'gpt-4o-mini'
            })
        });

        const data = await response.json();
        console.log("Status:", response.status);
        console.log("Data Keys:", Object.keys(data));
        console.log("Full Data:", JSON.stringify(data, null, 2));

        const providerKey = Object.keys(data).find(key => data[key]?.status === 'success');
        console.log("Found Provider Key:", providerKey);
    } catch (err) {
        console.error("Error:", err);
    }
}

testChat();
