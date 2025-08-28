import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import OpenAI from "openai";
import { DateTime } from "luxon";
import FormData from "form-data";
import fs from "fs";

// ENV with validation and fallbacks
const WA_TOKEN = process.env.WA_ACCESS_TOKEN || "";
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || "";
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "development-verify-token";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Initialize OpenAI client with error handling
let client: OpenAI | null = null;
if (OPENAI_API_KEY) {
  client = new OpenAI({ apiKey: OPENAI_API_KEY });
  console.log("✅ OpenAI client initialized");
} else {
  console.warn("⚠️ OpenAI API key not provided - AI features disabled");
}

// Check WhatsApp configuration
if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
  console.warn("⚠️ WhatsApp API credentials not configured - messaging disabled");
} else {
  console.log("✅ WhatsApp API configured");
}

const app = express();
app.use(bodyParser.json());

// --- Webhook verify (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  
  console.log("Webhook verification attempt:", { mode, token });
  
  if (mode === "subscribe" && token === WA_VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return res.status(200).send(challenge);
  }
  
  console.log("Webhook verification failed");
  return res.sendStatus(403);
});

// --- Webhook receive (POST)
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  
  try {
    console.log("Received webhook:", JSON.stringify(req.body, null, 2));
    
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    
    if (!msg) {
      console.log("No message found in webhook payload");
      return;
    }

    const from = msg.from; // E.164 without '+'
    const body = 
      msg.text?.body ||
      msg.button?.text ||
      msg.interactive?.list_reply?.title || "";

    console.log(`Message from ${from}: "${body}"`);
    
    await routeIncoming(from, body);
  } catch (e) { 
    console.error("Webhook error:", e); 
  }
});

// --- WhatsApp senders
async function sendText(to: string, text: string) {
  console.log(`Sending text to ${to}: "${text}"`);
  
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
    console.log("WhatsApp credentials not configured - message not sent");
    return;
  }
  
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${WA_TOKEN}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({ 
        messaging_product: "whatsapp", 
        to, 
        text: { body: text } 
      }),
    });
    
    const result = await response.json();
    console.log("WhatsApp API response:", result);
    
    if (!response.ok) {
      throw new Error(`WhatsApp API error: ${JSON.stringify(result)}`);
    }
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
  }
}

async function sendTemplate(to: string, name: string, variables: string[] = []) {
  console.log(`Sending template ${name} to ${to} with variables:`, variables);
  
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
    console.log("WhatsApp credentials not configured - template not sent");
    return;
  }
  
  try {
    const body: any = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: "en_US" }
      }
    };
    
    if (variables.length) {
      body.template.components = [{
        type: "body",
        parameters: variables.map(v => ({ type: "text", text: v }))
      }];
    }
    
    const response = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${WA_TOKEN}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify(body),
    });
    
    const result = await response.json();
    console.log("WhatsApp template API response:", result);
    
    if (!response.ok) {
      throw new Error(`WhatsApp API error: ${JSON.stringify(result)}`);
    }
  } catch (error) {
    console.error("Error sending WhatsApp template:", error);
  }
}

// Upload media file to WhatsApp
async function uploadMedia(filePath: string): Promise<string | null> {
  console.log(`Uploading media file: ${filePath}`);
  
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
    console.log("WhatsApp credentials not configured - media not uploaded");
    return null;
  }
  
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", fs.createReadStream(filePath));
    
    const response = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        ...form.getHeaders()
      },
      body: form as any
    });
    
    const result = await response.json() as any;
    console.log("Media upload response:", result);
    
    if (!response.ok) {
      throw new Error(`WhatsApp API error: ${JSON.stringify(result)}`);
    }
    
    return result.id;
  } catch (error) {
    console.error("Error uploading media:", error);
    return null;
  }
}

// Send image with caption
async function sendImage(to: string, mediaId: string, caption?: string) {
  console.log(`Sending image to ${to} with media ID: ${mediaId}`);
  
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
    console.log("WhatsApp credentials not configured - image not sent");
    return;
  }
  
  try {
    const body: any = {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        id: mediaId
      }
    };
    
    if (caption) {
      body.image.caption = caption;
    }
    
    const response = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${WA_TOKEN}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify(body),
    });
    
    const result = await response.json();
    console.log("WhatsApp image API response:", result);
    
    if (!response.ok) {
      throw new Error(`WhatsApp API error: ${JSON.stringify(result)}`);
    }
  } catch (error) {
    console.error("Error sending WhatsApp image:", error);
  }
}

// --- LLM tool definitions
const tools = [
  {
    type: "function" as const,
    function: {
      name: "set_reminder",
      description: "Create or schedule a reminder. Use when user asks to remember/do something.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          due_at_iso: { 
            type: "string", 
            description: "ISO8601; first slot >= this" 
          },
          scope: { 
            type: "string", 
            enum: ["personal","group"], 
            default: "personal" 
          },
          group_hint: { 
            type: "string", 
            description: "Optional group name mentioned." 
          }
        },
        required: ["text"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "create_calendar_event",
      description: "Create a calendar event for the user.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          start_iso: { type: "string" },
          end_iso: { type: "string" },
          location: { type: "string" }
        },
        required: ["title","start_iso","end_iso"]
      }
    }
  }
];

// --- Core router
async function routeIncoming(from: string, body: string) {
  // Fast-path commands
  const upper = body.trim().toUpperCase();
  if (["DONE","STOP"].some(c => upper.startsWith(c)) || upper.startsWith("SNOOZE")) {
    await handleCommand(from, upper);
    return;
  }

  // Check if OpenAI client is available
  if (!client) {
    console.log("OpenAI client not available, sending fallback response");
    await sendText(from, "Hello! I'm your reminder assistant. I'd respond more intelligently with an OpenAI API key configured. Try sending: DONE, STOP, or SNOOZE 1h");
    return;
  }

  const sys = `You are a concise WhatsApp assistant.
- If user asks to remember something, call set_reminder with scope=personal by default.
- If they say "for the family", "for us", "household" etc., set scope=group and include group_hint with the name if present.
- For meetings, call create_calendar_event.
- Never chit-chat when a tool call is possible. Timezone default Europe/Berlin.`;

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sys }, 
        { role: "user", content: body }
      ],
      tools,
      tool_choice: "auto",
    });

    const msg = resp.choices[0].message;
    const call = msg.tool_calls?.[0];

    if (!call) {
      await sendText(from, msg.content || "OK");
      return;
    }

    const args = JSON.parse(call.function.arguments || "{}");

    if (call.function.name === "set_reminder") {
      await createReminderFromLLM(from, args);
    } else if (call.function.name === "create_calendar_event") {
      await triggerCalendar(from, args);
    }
  } catch (error) {
    console.error("Error processing message with OpenAI:", error);
    await sendText(from, "Sorry, I encountered an error processing your request. Please try again.");
  }
}

// --- Commands
async function handleCommand(from: string, cmd: string) {
  console.log(`Handling command from ${from}: ${cmd}`);
  
  // Parse commands like "DONE", "STOP", "SNOOZE 1h", etc.
  // This will be expanded in Milestone 3 with DB integration
  if (cmd.startsWith("DONE")) {
    await sendText(from, "✅ Great! I've marked your reminder as complete.");
  } else if (cmd.startsWith("STOP")) {
    await sendText(from, "🛑 I've stopped your reminder. You won't get any more nudges for this item.");
  } else if (cmd.startsWith("SNOOZE")) {
    const match = cmd.match(/SNOOZE\s+(\d+)([HhDd])?/);
    const duration = match ? `${match[1]} ${match[2] || 'h'}` : "1 hour";
    await sendText(from, `😴 I've snoozed your reminder for ${duration}. I'll nudge you again after that.`);
  } else {
    await sendText(from, "I didn't understand that command. Try DONE, STOP, or SNOOZE 1h.");
  }
}

// --- Helper to compute next nudge slot
export function nextNudgeSlot(nowISO: string, times = ["09:00","18:00"], tz = "Europe/Berlin") {
  const now = DateTime.fromISO(nowISO, { zone: tz });
  const today = now.toISODate();
  
  if (!today) {
    throw new Error("Invalid date");
  }
  
  const todayCandidates = times
    .map(t => DateTime.fromISO(`${today}T${t}`, { zone: tz }))
    .filter(dt => dt > now)
    .sort((a, b) => +a - +b);
    
  if (todayCandidates.length) {
    return todayCandidates[0].toISO();
  }
  
  const tomorrow = now.plus({ days: 1 }).toISODate();
  if (!tomorrow) {
    throw new Error("Invalid date calculation");
  }
  
  return DateTime.fromISO(`${tomorrow}T${times[0]}`, { zone: tz }).toISO();
}

// --- Stubs (will be wired in Milestone 3)
async function createReminderFromLLM(from: string, args: any) {
  console.log(`Creating reminder from LLM for ${from}:`, args);
  
  // This will be expanded in Milestone 3 with proper DB operations
  // For now, just send confirmation
  await sendText(from, `✅ I'll remind you: "${args.text}". You'll get nudges at 09:00 & 18:00 until you reply DONE.`);
}

async function triggerCalendar(from: string, args: any) {
  console.log(`Triggering calendar event for ${from}:`, args);
  
  // This will POST to N8N webhook in Milestone 4
  // For now, just send confirmation
  await sendText(from, `📅 Event created: ${args.title} (${args.start_iso}–${args.end_iso}).`);
}

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Test endpoint to send a message (for development)
app.post("/test/send-message", async (req, res) => {
  const { to, message, type = "text" } = req.body;
  
  if (!to || !message) {
    return res.status(400).json({ error: "Missing 'to' or 'message' in request body" });
  }
  
  try {
    if (type === "template") {
      await sendTemplate(to, "hello_world", []);
    } else {
      await sendText(to, message);
    }
    res.json({ success: true, message: "Message sent successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to send message", details: error });
  }
});

// Test endpoint to upload and send media
app.post("/test/send-image", async (req, res) => {
  const { to, filePath, caption } = req.body;
  
  if (!to || !filePath) {
    return res.status(400).json({ error: "Missing 'to' or 'filePath' in request body" });
  }
  
  try {
    const mediaId = await uploadMedia(filePath);
    if (mediaId) {
      await sendImage(to, mediaId, caption);
      res.json({ success: true, mediaId });
    } else {
      res.status(500).json({ error: "Failed to upload media" });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to send image", details: error });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 API server running on port ${PORT}`);
  console.log(`📱 WhatsApp webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`🔧 Test endpoints available:`);
  console.log(`   POST http://localhost:${PORT}/test/send-message`);
  console.log(`   POST http://localhost:${PORT}/test/send-image`);
});