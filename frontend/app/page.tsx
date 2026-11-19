"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import AuthScreen from "./components/AuthScreen";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

/* ---------- Types ---------- */

type Source = {
  source_number: number;
  filename?: string;
  chunk_index?: number;
  text: string;
};

type ChatResult = {
  question: string;
  answer: string | null;
  status: string; // VERIFIED | BLOCK | CHAT | ...
  message?: string;
  total_sources?: number;
  sources?: Source[];
  confidence?: number;
};

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  question?: string;
  status?: string;
  confidence?: number;
  sources?: Source[];
};

type DocItem = { id: string; name: string; chunks: number };

type Session = {
  id: string;
  title: string;
  docId: string;
  messages: Message[];
  updatedAt: number;
};

type AnswerMode = "strict" | "general";

/* ---------- Helpers ---------- */

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const msgId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeSession(docId = ""): Session {
  return { id: uid(), title: "New chat", docId, messages: [], updatedAt: Date.now() };
}

const STOP_WORDS = new Set([
  "what", "which", "when", "where", "who", "whom", "whose", "why", "how",
  "does", "this", "that", "with", "from", "have", "about", "into", "your",
  "there", "their", "them", "then", "than", "were", "will", "would", "could",
  "should", "document", "tell", "give", "explain", "summarize", "summary",
]);

function keyTerms(question?: string): string[] {
  if (!question) return [];
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  return Array.from(new Set(words)).slice(0, 8);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * PDF chunks arrive with a line break after every visual line and often start
 * mid-word. Re-flow them into real paragraphs so they are pleasant to read.
 */
function cleanPassage(raw: string): string[] {
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/-\n(?=[a-z])/g, "") // join words hyphenated across lines
    .replace(/^\s*\w\s+(?=[A-Z])/, "") // drop a stray leading letter from a cut chunk
    .trim();

  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);
}

/** Heuristic trust score. Send `confidence` (0-100) from the backend to replace it. */
function trustScore(status?: string, sourceCount = 0, confidence?: number) {
  if (typeof confidence === "number") return Math.max(0, Math.min(100, Math.round(confidence)));
  const s = (status ?? "").toUpperCase();
  if (s === "VERIFIED") return Math.min(98, 78 + sourceCount * 7);
  if (s === "BLOCK" || s === "ERROR") return 0;
  return Math.min(68, 35 + sourceCount * 9);
}

function statusTone(status?: string) {
  const s = (status ?? "").toUpperCase();
  if (s === "VERIFIED")
    return {
      label: "Verified",
      bar: "bg-gradient-to-r from-cyan-400 to-emerald-400",
      chip: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
    };
  if (s === "BLOCK")
    return {
      label: "Blocked",
      bar: "bg-gradient-to-r from-rose-500 to-rose-400",
      chip: "bg-rose-400/10 text-rose-300 ring-rose-400/30",
    };
  if (s === "ERROR")
    return {
      label: "Error",
      bar: "bg-gradient-to-r from-rose-500 to-rose-400",
      chip: "bg-rose-400/10 text-rose-300 ring-rose-400/30",
    };
  return {
    label: "Needs review",
    bar: "bg-gradient-to-r from-amber-400 to-orange-400",
    chip: "bg-amber-400/10 text-amber-300 ring-amber-400/30",
  };
}

/**
 * Handles greetings and small talk locally so they never hit the RAG pipeline
 * (and never come back "Blocked"). Returns null when the message is a real question.
 */
function smallTalkReply(raw: string, docName?: string): string | null {
  const q = raw.toLowerCase().trim().replace(/[!.?,\s]+$/g, "");
  const words = q.split(/\s+/).length;
  const hasDoc = Boolean(docName);

  if (/^(hi+|hello+|hey+|heya|yo|hola|namaste|good (morning|afternoon|evening))(\s+(there|trustrag))?$/.test(q)) {
    return hasDoc
      ? `Hi! I'm TrustRAG. **${docName}** is loaded, so ask me anything about it. I can summarize it, find key facts, or explain a section.`
      : "Hi! I'm TrustRAG. Add a PDF, DOCX or TXT file and I'll answer questions about it, with the sources shown next to each answer. We can also just chat.";
  }
  if (words <= 5 && /^(how are you|how r u|how's it going|hows it going|what's up|whats up|sup|wassup)/.test(q)) {
    return "Doing well, thanks for asking! What would you like to work on today?";
  }
  if (words <= 4 && /^(thanks|thank you|thx|ty|cheers|great|nice|awesome|cool|perfect|ok|okay|got it)/.test(q)) {
    return "You're welcome! Ask another question whenever you're ready.";
  }
  if (words <= 3 && /^(bye|goodbye|see you|see ya|good night)/.test(q)) {
    return "Bye! Your chats are saved here when you come back.";
  }
  if (words <= 8 && /(who are you|what are you|your name|what can you do|how do you work|how to use|help me use)/.test(q)) {
    return [
      "I'm **TrustRAG**, an assistant that answers from your own documents.",
      "",
      "- Ask for a **summary**, key dates, names or numbers",
      "- Click a numbered citation to see the exact passage I used",
      "- Check the **trust score** on each answer before relying on it",
      "",
      "I can also handle normal conversation.",
    ].join("\n");
  }
  return null;
}

/* ---------- Small components ---------- */

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-amber-300/25 px-0.5 text-amber-100">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function TrustMeter({ status, sources, confidence }: { status?: string; sources: number; confidence?: number }) {
  const tone = statusTone(status);
  const score = trustScore(status, sources, confidence);
  return (
    <div
      className="flex items-center gap-3"
      title={`Based on verification status and ${sources} supporting source${sources === 1 ? "" : "s"}`}
    >
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone.chip}`}>
        {tone.label}
      </span>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full transition-all duration-700 ${tone.bar}`} style={{ width: `${score}%` }} />
        </div>
        <span className="text-xs tabular-nums text-slate-400">{score}% trust</span>
      </div>
    </div>
  );
}

function AnswerBody({ content, onCite }: { content: string; onCite: (n: number) => void }) {
  const markdown = content.replace(/\[(?:Source\s*)?(\d+)\]/gi, (_, n) => `[${n}](#cite-${n})`);
  return (
    <div className="text-[15.5px] leading-[1.8] text-slate-200">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const match = href?.match(/^#cite-(\d+)$/);
            if (match) {
              const n = Number(match[1]);
              return (
                <button
                  type="button"
                  onClick={() => onCite(n)}
                  className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-0.5 items-center justify-center rounded bg-gradient-to-br from-cyan-400 to-indigo-500 px-1 font-sans text-[10px] font-semibold text-white shadow-[0_0_12px_rgba(34,211,238,0.35)] transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  aria-label={`Open source ${n}`}
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-cyan-300 underline underline-offset-2">
                {children}
              </a>
            );
          },
          p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-4 list-disc space-y-1.5 pl-6 marker:text-cyan-400">{children}</ul>,
          ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1.5 pl-6 marker:text-cyan-400">{children}</ol>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          code: ({ children }) => (
            <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-cyan-200">{children}</code>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

const PREVIEW_CHARS = 420;

function Passage({
  source,
  terms,
  selected,
  fallbackName,
}: {
  source: Source;
  terms: string[];
  selected: boolean;
  fallbackName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const paragraphs = useMemo(() => cleanPassage(source.text), [source.text]);
  const full = paragraphs.join("\n\n");
  const long = full.length > PREVIEW_CHARS;
  const shown = open || !long ? full : full.slice(0, PREVIEW_CHARS).replace(/\s+\S*$/, "") + "…";

  const matched = terms.filter((t) => full.toLowerCase().includes(t)).length;

  useEffect(() => {
    if (selected) {
      setOpen(true);
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selected]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div
      ref={ref}
      id={`passage-${source.source_number}`}
      className={`anim-rise rounded-xl border p-4 transition ${
        selected
          ? "border-cyan-400/60 bg-cyan-400/[0.06] shadow-[0_0_30px_rgba(34,211,238,0.18)]"
          : "border-white/10 bg-white/[0.03] hover:border-white/20"
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-5 min-w-5 items-center justify-center rounded bg-gradient-to-br from-cyan-400 to-indigo-500 px-1 text-[11px] font-semibold text-white">
          {source.source_number}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
          {source.filename ?? fallbackName}
          {source.chunk_index !== undefined ? `, section ${source.chunk_index}` : ""}
        </span>
        {terms.length > 0 && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
              matched > 0 ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-slate-500"
            }`}
            title="How many keywords from your question appear in this passage"
          >
            {matched} of {terms.length} keywords
          </span>
        )}
      </div>

      <div className="space-y-3 text-[14px] leading-[1.75] text-slate-300">
        {shown.split("\n\n").map((p, i) => (
          <p key={i}>
            <Highlight text={p} terms={terms} />
          </p>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1 text-xs">
        {long && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-md px-2 py-1 font-medium text-cyan-300 hover:bg-cyan-400/10"
          >
            {open ? "Show less" : "Show full passage"}
          </button>
        )}
        <button onClick={() => void copy()} className="rounded-md px-2 py-1 text-slate-400 hover:bg-white/5">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [docs, setDocs] = useState<DocItem[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const [token, setToken] = useState("");
  const [user, setUser] = useState<{ id: number; email: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    try {
      const savedToken = sessionStorage.getItem("trustrag:token");
      const savedUser = sessionStorage.getItem("trustrag:user");

      if (savedToken && savedUser) {
        const parsedUser = JSON.parse(savedUser);

        if (
          typeof parsedUser.id === "number" &&
          typeof parsedUser.email === "string"
        ) {
          setToken(savedToken);
          setUser(parsedUser);
        } else {
          sessionStorage.removeItem("trustrag:token");
          sessionStorage.removeItem("trustrag:user");
        }
      }
    } catch {
      sessionStorage.removeItem("trustrag:token");
      sessionStorage.removeItem("trustrag:user");
    } finally {
      setAuthReady(true);
    }
  }, []);

  const [question, setQuestion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);

  const [topK, setTopK] = useState(3);
  const [mode, setMode] = useState<AnswerMode>("strict");

  const [focus, setFocus] = useState<{ messageId: number; source?: number } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const session = sessions.find((s) => s.id === activeSessionId);
  const messages = useMemo(() => session?.messages ?? [], [session]);
  const activeDoc = docs.find((d) => d.id === session?.docId);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  );

  /* ---------- Persistence ---------- */

  useEffect(() => {
    if (!authReady || !user) return;

    let loaded: {
      sessions: Session[];
      activeSessionId: string;
    } | null = null;

    try {
      const storageKey = `trustrag:v3:${user.id}`;
      const saved = localStorage.getItem(storageKey);

      if (saved) loaded = JSON.parse(saved);
    } catch {
      /* ignore corrupted storage */
    }

    const loadedSessions = loaded?.sessions?.length
      ? loaded.sessions
      : [makeSession()];

    setDocs([]);
    setSessions(loadedSessions);

    setActiveSessionId(
      loaded?.activeSessionId &&
        loadedSessions.some((s) => s.id === loaded.activeSessionId)
        ? loaded.activeSessionId
        : loadedSessions[0].id
    );

    setHydrated(true);
  }, [authReady, user]);

  useEffect(() => {
    if (!authReady || !token || !user) return;

    async function loadDocuments() {
      try {
        const response = await fetch(`${API_URL}/documents`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.status === 401) {
          sessionStorage.removeItem("trustrag:token");
          sessionStorage.removeItem("trustrag:user");
          setToken("");
          setUser(null);
          return;
        }

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || "Could not load documents.");
        }

        setDocs(data.documents ?? []);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Could not load documents."
        );
      }
    }

    void loadDocuments();
  }, [authReady, token, user]);

  useEffect(() => {
    if (!hydrated || !authReady || !user) return;

    try {
      const recent = [...sessions]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 40);

      const storageKey = `trustrag:v3:${user.id}`;

      localStorage.setItem(
        storageKey,
        JSON.stringify({
          sessions: recent,
          activeSessionId,
        })
      );
    } catch {
      /* storage full or unavailable */
    }
  }, [sessions, activeSessionId, hydrated, authReady, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, asking, activeSessionId]);

  /* ---------- Derived ---------- */

  const railMessage = useMemo(() => {
    if (focus) {
      const found = messages.find((m) => m.id === focus.messageId);
      if (found) return found;
    }
    return [...messages].reverse().find((m) => m.role === "assistant" && m.sources && m.sources.length > 0);
  }, [focus, messages]);

  const stats = useMemo(() => {
    const answers = messages.filter((m) => m.role === "assistant" && m.status?.toUpperCase() !== "CHAT");
    const verified = answers.filter((m) => m.status?.toUpperCase() === "VERIFIED").length;
    const blocked = answers.filter((m) => ["BLOCK", "ERROR"].includes(m.status?.toUpperCase() ?? "")).length;
    return { total: answers.length, verified, blocked, review: answers.length - verified - blocked };
  }, [messages]);

  const terms = keyTerms(railMessage?.question);

  /* ---------- Session actions ---------- */

  function updateSession(id: string, fn: (s: Session) => Session) {
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
  }

  function addMessage(sessionId: string, message: Message) {
    updateSession(sessionId, (s) => ({
      ...s,
      messages: [...s.messages, message],
      updatedAt: Date.now(),
      title:
        s.title === "New chat" && message.role === "user"
          ? message.content.length > 44
            ? message.content.slice(0, 44).trim() + "…"
            : message.content
          : s.title,
    }));
  }

  function newChat() {
    setFocus(null);
    setNotice("");
    if (session && session.messages.length === 0) {
      textareaRef.current?.focus();
      return;
    }
    const fresh = makeSession(session?.docId ?? "");
    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function openSession(id: string) {
    setActiveSessionId(id);
    setFocus(null);
    setNotice("");
  }

  function deleteSession(id: string) {
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const fresh = makeSession();
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
    } else {
      setSessions(remaining);
      if (id === activeSessionId) {
        const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setActiveSessionId(next.id);
      }
    }
    setFocus(null);
  }

  function openDoc(docId: string) {
    const existing = sortedSessions.find((s) => s.docId === docId);
    if (existing) {
      openSession(existing.id);
      return;
    }
    const fresh = makeSession(docId);
    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
    setFocus(null);
  }

  function removeDoc(id: string) {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    setSessions((prev) => prev.map((s) => (s.docId === id ? { ...s, docId: "" } : s)));
  }

  function handleUnauthorized() {
    sessionStorage.removeItem("trustrag:token");
    sessionStorage.removeItem("trustrag:user");

    setToken("");
    setUser(null);
    setDocs([]);
    setSessions([]);
    setActiveSessionId("");
    setHydrated(false);

    setNotice("Your session has expired. Please log in again.");
  }

  /* ---------- Upload + ask ---------- */

  async function handleUpload(file: File) {
    setUploading(true);
    setNotice("");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_URL}/documents/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Upload failed. Check the file type and try again.");

      const item: DocItem = {
        id: data.document_id,
        name: data.filename || file.name,
        chunks: data.total_chunks ?? 0,
      };
      setDocs((prev) => [item, ...prev.filter((d) => d.id !== item.id)]);

      if (session && session.messages.length === 0) {
        updateSession(session.id, (s) => ({ ...s, docId: item.id }));
      } else {
        const fresh = makeSession(item.id);
        setSessions((prev) => [fresh, ...prev]);
        setActiveSessionId(fresh.id);
      }
      setFocus(null);
      setNotice(`${item.name} is ready. ${item.chunks} sections indexed.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : `Can't reach the backend. Make sure the API is running on ${API_URL}`
      );
    } finally {
      setUploading(false);
    }
  }

  async function send(customQuestion?: string) {
    const q = (customQuestion ?? question).trim();
    if (!q || asking || !session) return;

    const sid = session.id;
    const doc = activeDoc;
    setNotice("");
    setQuestion("");
    addMessage(sid, { id: msgId(), role: "user", content: q });
    setAsking(true);

    try {
      // 1. Normal conversation never touches the RAG pipeline
      const chatReply = smallTalkReply(q, doc?.name);
      if (chatReply) {
        await sleep(450);
        addMessage(sid, { id: msgId(), role: "assistant", content: chatReply, status: "CHAT" });
        return;
      }

      // 2. Document questions need a document
      if (!doc) {
        await sleep(300);
        addMessage(sid, {
          id: msgId(),
          role: "assistant",
          status: "CHAT",
          content:
            "I need a document to answer that. Use **Add document** (or drop a file on this page), then ask again. Until then I'm happy to chat.",
        });
        return;
      }

      // 3. Real RAG question
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: q,
          document_id: doc.id,
          top_k: topK,
          answer_mode: mode,
        }),
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      const data: ChatResult = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.message === "string" ? data.message : "The question failed. Try again.");
      }

      const isChat = data.status?.toUpperCase() === "CHAT";
      const id = msgId();
      addMessage(sid, {
        id,
        role: "assistant",
        content: data.answer || data.message || "No answer was returned.",
        question: q,
        status: data.status,
        confidence: data.confidence,
        sources: isChat ? [] : data.sources ?? [],
      });
      if (!isChat) setFocus({ messageId: id });
    } catch (error) {
      addMessage(sid, {
        id: msgId(),
        role: "assistant",
        content:
          error instanceof Error ? error.message : `Can't reach the backend. Make sure the API is running on ${API_URL}`,
        status: "ERROR",
      });
    } finally {
      setAsking(false);
    }
  }

  async function copyAnswer(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setNotice("Couldn't copy. Select the text and copy it manually.");
    }
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleUpload(file);
  }

  const starters = [
    "Summarize this document in five points",
    "List the important dates, names and numbers",
    "What are the main risks or conditions mentioned?",
    "Explain the hardest section in simple words",
  ];

  /* ---------- Render ---------- */

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#05070d] text-slate-300">
        Checking your session...
      </main>
    );
  }

  if (!token || !user) {
    return (
      <AuthScreen
        onAuthenticated={(newToken, newUser) => {
          sessionStorage.setItem("trustrag:token", newToken);
          sessionStorage.setItem("trustrag:user", JSON.stringify(newUser));

          setToken(newToken);
          setUser(newUser);
        }}
      />
    );
  }

  const selectClass =
    "rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-sm text-slate-200 outline-none transition hover:border-white/20 focus:border-cyan-400/60";

  return (
    <main
      className="relative flex h-screen overflow-hidden bg-[#05070d] text-slate-200 [color-scheme:dark]"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {/* ===== background ===== */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="anim-float-a absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-cyan-500/20 blur-[130px]" />
        <div className="anim-float-b absolute -bottom-48 right-0 h-[620px] w-[620px] rounded-full bg-indigo-600/25 blur-[140px]" />
        <div className="anim-float-a absolute left-1/2 top-1/3 h-[360px] w-[360px] rounded-full bg-fuchsia-500/10 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.3]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
          }}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUpload(file);
          e.target.value = "";
        }}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[#05070d]/70 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-cyan-400/70 bg-white/[0.05] px-10 py-8 text-center shadow-[0_0_60px_rgba(34,211,238,0.25)] backdrop-blur-xl">
            <p className="text-base font-medium text-cyan-200">Drop to add this document</p>
            <p className="mt-1 text-sm text-slate-400">PDF, DOCX or TXT</p>
          </div>
        </div>
      )}

      {/* ---------- Sidebar ---------- */}
      <aside className="relative z-10 hidden w-[280px] shrink-0 flex-col border-r border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl md:flex">
        <div className="mb-5 flex items-center gap-3 px-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-[15px] font-bold text-white shadow-[0_0_24px_rgba(34,211,238,0.4)]">
            T
          </div>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">
              TrustRAG <span className="text-cyan-300">AI</span>
            </h1>
            <p className="text-xs text-slate-400">Answers you can check</p>
          </div>
        </div>

        <button
          onClick={newChat}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(56,189,248,0.3)] transition hover:-translate-y-0.5 hover:shadow-[0_8px_36px_rgba(56,189,248,0.5)]"
        >
          <span className="text-base leading-none">+</span> New chat
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-400/50 hover:bg-white/[0.07] disabled:opacity-60"
        >
          {uploading ? "Indexing document…" : "Add document"}
        </button>

        <div className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {/* Chats */}
          <div>
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Chats</p>
            <ul className="space-y-0.5">
              {sortedSessions.map((s) => {
                const docName = docs.find((d) => d.id === s.docId)?.name;
                return (
                  <li key={s.id}>
                    <div
                      className={`group flex items-center gap-1 rounded-xl px-3 py-2 transition ${
                        s.id === activeSessionId
                          ? "bg-white/[0.08] ring-1 ring-cyan-400/30 shadow-[0_0_20px_rgba(34,211,238,0.08)]"
                          : "hover:bg-white/[0.05]"
                      }`}
                    >
                      <button onClick={() => openSession(s.id)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-sm text-slate-100">{s.title}</span>
                        {docName && <span className="block truncate text-xs text-slate-500">{docName}</span>}
                      </button>
                      <button
                        onClick={() => deleteSession(s.id)}
                        className="rounded px-1.5 text-slate-500 opacity-0 transition hover:text-rose-400 focus-visible:opacity-100 group-hover:opacity-100"
                        aria-label={`Delete chat ${s.title}`}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Documents */}
          <div>
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Documents
            </p>
            {docs.length === 0 ? (
              <p className="px-1 text-sm leading-6 text-slate-500">
                None yet. Add a PDF, DOCX or TXT file, or drop one anywhere on this page.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {docs.map((doc) => (
                  <li key={doc.id}>
                    <div
                      className={`group flex items-center gap-1 rounded-xl px-3 py-2 transition ${
                        doc.id === session?.docId
                          ? "bg-white/[0.06] ring-1 ring-white/15"
                          : "hover:bg-white/[0.05]"
                      }`}
                    >
                      <button onClick={() => openDoc(doc.id)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-sm font-medium text-slate-100">{doc.name}</span>
                        <span className="block text-xs text-slate-500">{doc.chunks} sections</span>
                      </button>
                      <button
                        onClick={() => removeDoc(doc.id)}
                        className="rounded px-1.5 text-slate-500 opacity-0 transition hover:text-rose-400 focus-visible:opacity-100 group-hover:opacity-100"
                        aria-label={`Remove ${doc.name}`}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Trust summary */}
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Trust in this chat</p>
          {stats.total === 0 ? (
            <p className="mt-1.5 text-sm text-slate-400">No document answers yet.</p>
          ) : (
            <>
              <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="bg-gradient-to-r from-cyan-400 to-emerald-400"
                  style={{ width: `${(stats.verified / stats.total) * 100}%` }}
                />
                <div className="bg-amber-400" style={{ width: `${(stats.review / stats.total) * 100}%` }} />
                <div className="bg-rose-500" style={{ width: `${(stats.blocked / stats.total) * 100}%` }} />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                {stats.verified} verified, {stats.review} to review, {stats.blocked} blocked
              </p>
            </>
          )}
        </div>

        {/* Account and logout */}
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-2 truncate px-2 text-xs text-slate-500">{user.email}</p>

          <button
            onClick={() => {
              sessionStorage.removeItem("trustrag:token");
              sessionStorage.removeItem("trustrag:user");
              setToken("");
              setUser(null);
              setDocs([]);
              setSessions([]);
              setActiveSessionId("");
              setHydrated(false);
            }}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-rose-400/40 hover:bg-rose-400/10 hover:text-rose-300"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* ---------- Conversation ---------- */}
      <section className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-white/[0.02] px-5 backdrop-blur-xl md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <select
              value={session?.docId ?? ""}
              onChange={(e) => session && updateSession(session.id, (s) => ({ ...s, docId: e.target.value }))}
              className={`max-w-[260px] truncate ${selectClass}`}
              aria-label="Document for this chat"
            >
              <option value="" className="bg-[#0b1220]">
                No document
              </option>
              {docs.map((d) => (
                <option key={d.id} value={d.id} className="bg-[#0b1220]">
                  {d.name}
                </option>
              ))}
            </select>
            {activeDoc && (
              <span className="hidden items-center gap-1.5 text-xs text-emerald-300 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                Ready
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 md:hidden"
            >
              Add document
            </button>
            <button
              onClick={newChat}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-cyan-400/50 hover:bg-white/[0.07]"
            >
              New chat
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-5 pb-10 pt-8 md:px-8">
            {messages.length === 0 && (
              <div className="anim-rise flex min-h-[52vh] flex-col justify-center">
                <h2 className="text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-[44px]">
                  Ask your document.
                  <br />
                  <span className="bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-400 bg-clip-text text-transparent">
                    See the proof.
                  </span>
                </h2>
                <p className="mt-4 max-w-md text-[15px] leading-7 text-slate-400">
                  Every document answer comes with the exact passages it was built from, a trust score and clickable
                  citations. You can also just chat.
                </p>

                {activeDoc ? (
                  <div className="mt-8 grid gap-2 sm:grid-cols-2">
                    {starters.map((s) => (
                      <button
                        key={s}
                        onClick={() => void send(s)}
                        className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm leading-6 text-slate-300 backdrop-blur transition hover:-translate-y-0.5 hover:border-cyan-400/50 hover:bg-white/[0.07] hover:text-white"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-8 w-fit rounded-xl bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_40px_rgba(56,189,248,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_50px_rgba(56,189,248,0.55)]"
                  >
                    Add a document to start
                  </button>
                )}
              </div>
            )}

            {messages.map((message) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="anim-rise mb-8 flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-cyan-500 to-indigo-600 px-4 py-3 text-sm leading-6 text-white shadow-[0_8px_30px_rgba(56,189,248,0.25)]">
                      {message.content}
                    </div>
                  </div>
                );
              }

              const isChat = message.status?.toUpperCase() === "CHAT";
              const sourceCount = message.sources?.length ?? 0;

              return (
                <article key={message.id} className="anim-rise mb-10">
                  {!isChat && (
                    <div className="mb-3">
                      <TrustMeter status={message.status} sources={sourceCount} confidence={message.confidence} />
                    </div>
                  )}

                  <AnswerBody
                    content={message.content}
                    onCite={(n) => setFocus({ messageId: message.id, source: n })}
                  />

                  <div className="mt-4 flex flex-wrap items-center gap-1 text-xs text-slate-400">
                    {sourceCount > 0 && (
                      <button
                        onClick={() => setFocus({ messageId: message.id })}
                        className={`rounded-md px-2 py-1 font-medium transition hover:bg-white/10 ${
                          railMessage?.id === message.id ? "bg-cyan-400/10 text-cyan-300" : ""
                        }`}
                      >
                        {sourceCount} source{sourceCount === 1 ? "" : "s"}
                      </button>
                    )}
                    <button onClick={() => void copyAnswer(message)} className="rounded-md px-2 py-1 hover:bg-white/10">
                      {copiedId === message.id ? "Copied" : "Copy"}
                    </button>
                    {message.question && (
                      <button
                        onClick={() => void send(message.question)}
                        className="rounded-md px-2 py-1 hover:bg-white/10"
                      >
                        Ask again
                      </button>
                    )}
                  </div>

                  {/* Sources inline on small screens (the side rail is hidden there) */}
                  {sourceCount > 0 && (
                    <div className="mt-3 space-y-2 lg:hidden">
                      {message.sources!.map((source) => (
                        <Passage
                          key={source.source_number}
                          source={source}
                          terms={keyTerms(message.question)}
                          selected={false}
                          fallbackName={activeDoc?.name}
                        />
                      ))}
                    </div>
                  )}
                </article>
              );
            })}

            {asking && (
              <div className="flex items-center gap-3 py-3 text-sm text-slate-400" role="status">
                <span className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" />
                </span>
                Thinking…
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-white/10 bg-white/[0.02] px-4 pb-4 pt-3 backdrop-blur-xl md:px-8">
          <div className="mx-auto max-w-2xl">
            {notice && (
              <p className="mb-2 text-sm text-cyan-200/80" role="status">
                {notice}
              </p>
            )}

            <div className="composer-glow">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
                className="rounded-[15px] bg-[#0a0e17] p-3"
              >
                <textarea
                  ref={textareaRef}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={activeDoc ? `Ask about ${activeDoc.name}, or just say hi` : "Say hi, or add a document to begin"}
                  rows={2}
                  className="max-h-40 min-h-[48px] w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500"
                />

                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="rounded-md px-2 py-1.5 font-medium hover:bg-white/10 disabled:opacity-50"
                    >
                      {uploading ? "Uploading…" : "Attach"}
                    </button>

                    <label className="flex items-center gap-1.5">
                      <span className="text-slate-500">Passages</span>
                      <select
                        value={topK}
                        onChange={(e) => setTopK(Number(e.target.value))}
                        className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-1 text-slate-200 outline-none focus:border-cyan-400/60"
                      >
                        {[2, 3, 5, 8].map((n) => (
                          <option key={n} value={n} className="bg-[#0b1220]">
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="flex overflow-hidden rounded-md border border-white/10" role="group" aria-label="Answer mode">
                      {(["strict", "general"] as AnswerMode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMode(m)}
                          aria-pressed={mode === m}
                          className={`px-2.5 py-1 capitalize transition ${
                            mode === m
                              ? "bg-gradient-to-r from-cyan-500 to-indigo-500 text-white"
                              : "bg-white/[0.03] text-slate-400 hover:bg-white/10"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!question.trim() || asking || uploading}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-lg text-white shadow-[0_6px_24px_rgba(56,189,248,0.4)] transition hover:scale-105 disabled:cursor-not-allowed disabled:bg-none disabled:bg-white/10 disabled:text-slate-500 disabled:shadow-none disabled:hover:scale-100"
                    aria-label="Send message"
                  >
                    ↑
                  </button>
                </div>
              </form>
            </div>

            <p className="mt-2 text-center text-xs text-slate-500">
              Document answers come from your file only. Check the sources before relying on them.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Evidence rail ---------- */}
      <aside className="relative z-10 hidden w-[420px] shrink-0 flex-col border-l border-white/10 bg-white/[0.03] backdrop-blur-xl lg:flex">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
            Evidence
          </h3>
          {railMessage?.sources && railMessage.sources.length > 0 && (
            <div className="flex items-center gap-1">
              {railMessage.sources.map((s) => (
                <button
                  key={s.source_number}
                  onClick={() => setFocus({ messageId: railMessage.id, source: s.source_number })}
                  className={`h-6 min-w-6 rounded px-1.5 text-xs font-semibold transition ${
                    focus?.source === s.source_number
                      ? "bg-gradient-to-br from-cyan-400 to-indigo-500 text-white shadow-[0_0_12px_rgba(34,211,238,0.4)]"
                      : "bg-white/[0.06] text-slate-400 hover:bg-white/10 hover:text-white"
                  }`}
                  aria-label={`Jump to source ${s.source_number}`}
                >
                  {s.source_number}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!railMessage || !railMessage.sources || railMessage.sources.length === 0 ? (
            <p className="text-sm leading-6 text-slate-500">
              The passages behind a document answer appear here. Click a numbered citation in any answer to jump to its
              source.
            </p>
          ) : (
            <>
              <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Your question</p>
                <p className="mt-1 text-sm leading-6 text-slate-200">{railMessage.question}</p>
              </div>
              <div className="space-y-3">
                {railMessage.sources.map((source) => (
                  <Passage
                    key={`${railMessage.id}-${source.source_number}-${source.chunk_index}`}
                    source={source}
                    terms={terms}
                    selected={focus?.source === source.source_number}
                    fallbackName={activeDoc?.name}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </main>
  );
}