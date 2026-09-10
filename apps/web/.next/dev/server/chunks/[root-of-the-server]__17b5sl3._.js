module.exports = [
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/runtime-reacts.external.js", () => require("next/dist/server/runtime-reacts.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[project]/apps/web/app/api/zappr/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
]);
const MODELS = {
    gemini: 'gemini-3.6-flash',
    openai: 'gpt-4o-mini',
    openrouter: 'google/gemini-2.0-flash-exp:free',
    anthropic: 'claude-sonnet-4-6',
    ollama: 'qwen2.5-coder:7b'
};
async function POST(req) {
    const { prompt, messages = [], apiKey, provider = 'gemini' } = await req.json();
    if (!apiKey && provider !== 'ollama') return new Response('API key required', {
        status: 401
    });
    if (!prompt) return new Response('Prompt required', {
        status: 400
    });
    const model = MODELS[provider] ?? MODELS.gemini;
    const systemPrompt = 'You are Zappr, an expert AI coding assistant by Fixora (NOVAA Studios). Help the user fix, explain, and create code. Be concise and use markdown with code blocks.';
    // The conversation so far (already includes the latest user turn — the client appends it
    // before sending), converted into each provider's own history shape.
    const history = messages.length > 0 ? messages : [
        {
            role: 'user',
            content: prompt
        }
    ];
    let url;
    let headers;
    let body;
    if (provider === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
        headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        };
        body = {
            systemInstruction: {
                parts: [
                    {
                        text: systemPrompt
                    }
                ]
            },
            contents: history.map((m)=>({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [
                        {
                            text: m.content
                        }
                    ]
                }))
        };
    } else if (provider === 'anthropic') {
        url = 'https://api.anthropic.com/v1/messages';
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        };
        body = {
            model,
            messages: history.map((m)=>({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: m.content
                })),
            system: systemPrompt,
            stream: true,
            max_tokens: 4096
        };
    } else if (provider === 'ollama') {
        url = 'http://localhost:11434/v1/chat/completions';
        headers = {
            'Content-Type': 'application/json'
        };
        body = {
            model,
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                ...history.map((m)=>({
                        role: m.role,
                        content: m.content
                    }))
            ],
            stream: true
        };
    } else {
        const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
        url = `${baseUrl}/chat/completions`;
        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };
        body = {
            model,
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                ...history.map((m)=>({
                        role: m.role,
                        content: m.content
                    }))
            ],
            stream: true
        };
    }
    const upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    if (!upstream.ok) return new Response(await upstream.text(), {
        status: upstream.status
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start (controller) {
            const reader = upstream.body.getReader();
            const decoder = new TextDecoder();
            while(true){
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                for (const line of chunk.split('\n')){
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(data);
                        let text = '';
                        if (provider === 'gemini') {
                            const candidates = parsed.candidates ?? [];
                            text = candidates[0]?.content?.parts[0]?.text ?? '';
                        } else if (provider === 'anthropic') {
                            const delta = parsed.delta;
                            text = delta?.text ?? '';
                        } else {
                            const choices = parsed.choices ?? [];
                            text = choices[0]?.delta?.content ?? '';
                        }
                        if (text) controller.enqueue(encoder.encode(text));
                    } catch  {}
                }
            }
            controller.close();
        }
    });
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8'
        }
    });
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__17b5sl3._.js.map