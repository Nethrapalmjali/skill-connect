import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import cors from "cors";
import bodyParser from "body-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, "db.json");
const JWT_SECRET = process.env.JWT_SECRET || "skill-connect-secret-key";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// In-memory DB for Vercel/Production environments where filesystem is read-only
let memoryDb: any = null;

function readDB() {
  if (memoryDb) return memoryDb;
  
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, "utf-8");
      memoryDb = JSON.parse(data);
    } else {
      memoryDb = { users: [], jobs: [], courses: [] };
    }
  } catch (e) {
    console.error("Error reading DB:", e);
    memoryDb = { users: [], jobs: [], courses: [] };
  }
  return memoryDb;
}

function writeDB(data: any) {
  memoryDb = data;
  // Skip filesystem writes on Vercel
  if (process.env.VERCEL) return;
  
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Error writing DB:", e);
  }
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Auth Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// API routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", environment: process.env.VERCEL ? "vercel" : "local" });
});

app.post("/api/auth/register", async (req, res) => {
  const { email, password, name } = req.body;
  const db = readDB();
  
  if (db.users.find((u: any) => u.email === email)) {
    return res.status(400).json({ message: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    id: Date.now().toString(),
    email,
    password: hashedPassword,
    name,
    skills: [],
    education: "",
    interests: [],
    assessments: []
  };

  db.users.push(newUser);
  writeDB(db);

  const token = jwt.sign({ id: newUser.id, email: newUser.email }, JWT_SECRET);
  res.json({ token, user: { id: newUser.id, email: newUser.email, name: newUser.name } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find((u: any) => u.email === email);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get("/api/user/profile", authenticateToken, (req: any, res) => {
  const db = readDB();
  const user = db.users.find((u: any) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  
  const { password, ...userProfile } = user;
  res.json(userProfile);
});

app.put("/api/user/profile", authenticateToken, (req: any, res) => {
  const db = readDB();
  const userIndex = db.users.findIndex((u: any) => u.id === req.user.id);
  if (userIndex === -1) return res.status(404).json({ message: "User not found" });

  // Only allow whitelisted fields so clients cannot overwrite id, email or password
  const allowed = ["name", "skills", "education", "interests", "assessments"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body && key in req.body) updates[key] = req.body[key];
  }

  db.users[userIndex] = { ...db.users[userIndex], ...updates };
  writeDB(db);
  res.json({ message: "Profile updated successfully" });
});

app.get("/api/jobs", (req, res) => {
  const db = readDB();
  res.json(db.jobs);
});

app.get("/api/courses", (req, res) => {
  const db = readDB();
  res.json(db.courses);
});

app.post("/api/gemini/analyze", async (req, res) => {
  try {
    const { prompt, config } = req.body;

    if (GROQ_API_KEY) {
      const { default: Groq } = await import("groq-sdk");
      const groq = new Groq({ apiKey: GROQ_API_KEY });
      
      const completion = await groq.chat.completions.create({
        messages: [
          { 
            role: "system", 
            content: "You are a professional career advisor assisting with skills, jobs, and resumes. Always respond in valid JSON format." 
          },
          {
            role: "user",
            content: prompt
          }
        ],
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" }
      });

      return res.json({ text: completion.choices[0]?.message?.content });
    }

    if (GEMINI_API_KEY && GEMINI_API_KEY !== "MY_GEMINI_API_KEY") {
      const { GoogleGenAI } = await import("@google/genai");
      const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = (client as any).getGenerativeModel({ model: config?.model || "gemini-1.5-flash" });
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return res.json({ text: response.text() });
    }

    return res.status(500).json({ error: "No valid AI API key configured" });
  } catch (error: any) {
    console.error("AI API Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Deployment logic
const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

if (!isProd) {
  // Vite middleware for development
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);

  app.use('*', async (req, res, next) => {
    const url = req.originalUrl;
    try {
      let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
      template = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (e: any) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
  
  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Development server running on http://localhost:${PORT}`);
  });
} else {
  // Production static file serving
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  
  // API routes are already defined above
  
  // SPA fallback
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: "Not found" });
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

export default app;
