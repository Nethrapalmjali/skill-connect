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
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  console.warn("WARNING: JWT_SECRET is not set; using an insecure default. Set JWT_SECRET in production.");
}
// Auth tokens expire so a leaked token is not valid forever
const TOKEN_TTL = "7d";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
    if (err) return res.sendStatus(err.name === "TokenExpiredError" ? 401 : 403);
    req.user = user;
    next();
  });
};

// API routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", environment: process.env.VERCEL ? "vercel" : "local" });
});

app.post("/api/auth/register", async (req, res) => {
  const { email: rawEmail, password, name } = req.body || {};
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ message: "A valid email is required" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ message: "Name is required" });
  }
  const db = readDB();
  
  if (db.users.find((u: any) => String(u.email).toLowerCase() === email)) {
    return res.status(400).json({ message: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    id: Date.now().toString(),
    email,
    password: hashedPassword,
    name: name.trim(),
    skills: [],
    education: "",
    interests: [],
    assessments: []
  };

  db.users.push(newUser);
  writeDB(db);

  const token = jwt.sign({ id: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, user: { id: newUser.id, email: newUser.email, name: newUser.name } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email: rawEmail, password } = req.body || {};
  if (typeof rawEmail !== "string" || typeof password !== "string") {
    return res.status(400).json({ message: "Email and password are required" });
  }
  const email = rawEmail.trim().toLowerCase();
  const db = readDB();
  const user = db.users.find((u: any) => String(u.email).toLowerCase() === email);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
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

  const isStringArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  if ("name" in updates && (typeof updates.name !== "string" || !updates.name.trim())) {
    return res.status(400).json({ message: "Name must be a non-empty string" });
  }
  if ("education" in updates && typeof updates.education !== "string") {
    return res.status(400).json({ message: "Education must be a string" });
  }
  for (const key of ["skills", "interests"]) {
    if (key in updates && !isStringArray(updates[key])) {
      return res.status(400).json({ message: `${key} must be an array of strings` });
    }
  }
  if ("assessments" in updates && !Array.isArray(updates.assessments)) {
    return res.status(400).json({ message: "assessments must be an array" });
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
    const { prompt, config } = req.body || {};
    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "A non-empty prompt is required" });
    }

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
      const response = await client.models.generateContent({
        model: config?.model || "gemini-2.0-flash",
        contents: prompt,
      });
      return res.json({ text: response.text });
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
