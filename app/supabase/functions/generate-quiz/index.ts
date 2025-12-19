import { createClient } from "@supabase/supabase-js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, Command, interrupt } from "@langchain/langgraph";
import { SupabaseSaver } from "./SupabaseSaver.ts";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import * as cheerio from "cheerio";
import { z } from "zod";

// --- Config ---
const NUM_SENTENCES = 10;
const WORKER_URL = 'http://host.docker.internal:3001/generate_quiz';
const MAX_WAIT_MINUTES = 5;

// Helper to get an LLM (Used only for formatting prompt now, or can be removed if prompt is purely string based)
function getLLM() {
  const provider = (Deno.env.get("LLM_PROVIDER") || "google").toLowerCase();
  const modelName = Deno.env.get("LLM_MODEL") || "gemini-2.5-flash";
  const temperature = 0.7;

  if (provider.includes("google") || provider.includes("gemini")) {
    return new ChatGoogleGenerativeAI({
      model: modelName,
      temperature,
      apiKey: Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("LLM_API_KEY"),
    });
  }

  const apiKey = Deno.env.get("LLM_API_KEY") || "dummy-key";
  let baseUrl = Deno.env.get("LLM_BASE_URL");
  if (!baseUrl) {
    if (provider === "openrouter") baseUrl = "https://openrouter.ai/api/v1";
    if (provider === "local") baseUrl = "http://host.docker.internal:1234/v1";
  }

  return new ChatOpenAI({
    model: modelName,
    temperature,
    apiKey,
    configuration: baseUrl ? { baseURL: baseUrl } : undefined,
  });
}

// --- Interfaces ---
interface QuizQuestion {
  question: string;
  answer: string;
  english: string;
}

const QuizSchema = z.array(z.object({
  question: z.string(),
  answer: z.string(),
  english: z.string(),
}));

interface AgentState {
  // Inputs
  user_token: string;
  user_id: string;
  word_list_ids: number[];

  // Pipeline Data
  target_words: string[];
  article_url?: string;
  article_title?: string;
  article_text?: string;

  // Job Data
  quiz_id?: number;

  // Output
  generated_quiz?: QuizQuestion[];
  error?: string;
}

// --- Supabase Helpers ---
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseGlobal = createClient(supabaseUrl, supabaseKey);
const checkpointer = new SupabaseSaver(supabaseGlobal);

function supabaseClient(user_token: string) {
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${user_token}` } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

// --- Node Functions ---

async function fetchWordsNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error) return {};
  console.log("--- Step 1: Fetching Target Words ---");

  const supabase = supabaseClient(state.user_token);

  if (!state.word_list_ids || state.word_list_ids.length === 0) {
    return { target_words: ["nieuws", "vandaag", "belangrijk"] };
  }

  const { data, error } = await supabase
    .from("word_lists")
    .select("words")
    .in("id", state.word_list_ids);

  if (error) return { error: `DB Error: ${error.message}` };
  const allWords: string[] = data.flatMap((row: any) => row.words || []);
  const uniqueWords = [...new Set(allWords)];

  return { target_words: uniqueWords.length > 0 ? uniqueWords : ["general"] };
}

async function pickArticleNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error) return {};
  console.log("--- Step 2: Picking Article ---");

  try {
    const response = await fetch("https://nos.nl");
    const html = await response.text();
    const $ = cheerio.load(html);

    const links: string[] = [];
    $("a[href*='/artikel/']").each((_, element) => {
      const href = $(element).attr("href");
      if (href) links.push(href);
    });

    if (links.length === 0) return { error: "No articles found" };
    const selectedPath = links[Math.floor(Math.random() * links.length)];
    return { article_url: `https://nos.nl${selectedPath}` };
  } catch (e: any) {
    return { error: e.message };
  }
}

async function scrapeContentNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error || !state.article_url) return {};
  console.log(`--- Step 3: Scraping ${state.article_url} ---`);

  try {
    const response = await fetch(state.article_url);
    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $("title").text().replace(" | NOS", "").trim();
    let paragraphs = $("article p");
    if (paragraphs.length === 0) paragraphs = $("p");

    const textParts: string[] = [];
    paragraphs.each((_, el) => textParts.push($(el).text()));

    return {
      article_text: textParts.join(" ").slice(0, 8000),
      article_title: title
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

async function triggerWorkerNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error || !state.article_text) return {};
  console.log("--- Step 4: Creating Quiz Job & Triggering Worker ---");

  const supabase = supabaseClient(state.user_token);

  // 1. Prepare Prompt Payload (We don't call LLM here, just format)
  const promptText = `
    You are a Dutch language teacher creating exercises.

    CONTEXT ARTICLE:
    {article_text}

    TARGET WORDS TO INCLUDE:
    {target_words}

    TASK:
    1. Extract or create {num_sentences} simplified sentences based on the context. Try to
       include the target words in at least {subset_sentences} of the {num_sentences} sentences.
    2. Choose one word per sentence that is self-evident from context, again focusing on
       the target words as much as possible.
    3. Include a field with the English translation.
    4. Respond ONLY with a valid JSON list.

    FORMAT EXAMPLE:
    [
      {{"sentence": "Het schrijven van een brief is een lastige klus.", "answer": klus", "english", "Writing a letter is a difficult task."}},
      ...
    ]
  `;

  const prompt = await ChatPromptTemplate.fromTemplate(promptText).invoke({
    article_text: state.article_text,
    target_words: state.target_words.join(", "),
    num_sentences: NUM_SENTENCES,
    subset_sentences: parseInt(NUM_SENTENCES*3/4),
  });

  // 2. Insert Placeholder Quiz in DB
  const { data: quiz, error: quizError } = await supabase
    .from("quizzes")
    .insert({
      user_id: state.user_id,
      context: {
        title: state.article_title,
        url: state.article_url,
        type: 'article'
      },
      content: null, // Worker will fill this
      status: "generating"
    })
    .select("id")
    .single();

  if (quizError) return { error: quizError.message };
  console.log('new quiz:', quiz);

  // 3. Call External Worker
  try {
    console.log(`Triggering worker for quiz_id: ${quiz.id}`);
    const workerResp = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        quiz_id: quiz.id,
        user_id: state.user_id,
        webhook: Deno.env.get('NEXT_PUBLIC_SUPABASE_URL') + '/functions/v1/save-quiz',
        user_token: state.user_token
      })
    });

    if (!workerResp.ok) throw new Error(`Worker returned ${workerResp.status}`);

  } catch (e: any) {
    return { error: `Failed to call worker: ${e.message}` };
  }

  return { quiz_id: quiz.id };
}

// checks DB, updates state, returns
async function checkStatusNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error || !state.article_text) return {};
  console.log(`--- Checking Status for Quiz ${state.quiz_id} ---`);

  const supabase = supabaseClient(state.user_token);
  const { data, error } = await supabase
    .from("quizzes")
    .select("content, status, created_at")
    .eq("id", state.quiz_id)
    .single();
  console.log(`quiz ${state.quiz_id} has status ${data.status}`);

  if (error) return { error: error.message };
  
  // If content is ready
  if (data.content !== null) {
    return { generated_quiz: data.content };
  }
  
  // If error or timeout, handle logic here...
  if (data.status === 'error') return { error: "Worker error" };

  // If still waiting, we return NOTHING different. 
  // The state remains generated_quiz: undefined.
  return {}; 
}

// handles the pause so that if we resume here we don't have to re-execute the query, we
// rely on the graph to cycle back to check_status for that.
function waitNode(state: AgentState) {
    console.log("--- Pause: Waiting for Client/Worker ---");
    // This value is returned when the client calls resume
    interrupt("Waiting for external worker...");
    return {};
}

async function finalizeQuizNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error) return {};
  console.log("--- Step 6: Finalizing Quiz ---");

  const supabase = supabaseClient(state.user_token);

  // Update Status
  await supabase
    .from("quizzes")
    .update({ status: "ready" })
    .eq("id", state.quiz_id);

  // Link Word Lists
  if (state.word_list_ids && state.word_list_ids.length > 0) {
    const links = state.word_list_ids.map(id => ({
      quiz_id: state.quiz_id,
      word_list_id: id
    }));
    await supabase.from("quiz_word_lists").insert(links);
  }

  return {};
}

// --- Graph Definition ---

const workflow = new StateGraph<AgentState>({
  channels: {
    user_token: null,
    user_id: null,
    word_list_ids: null,
    target_words: null,
    article_url: null,
    article_title: null,
    article_text: null,
    generated_quiz: null,
    quiz_id: null,
    error: null
  }
});

workflow.addNode("fetch_words", fetchWordsNode);
workflow.addNode("pick_article", pickArticleNode);
workflow.addNode("scrape_content", scrapeContentNode);
workflow.addNode("trigger_worker", triggerWorkerNode);
workflow.addNode("check_status", checkStatusNode);
workflow.addNode("wait_node", waitNode);
workflow.addNode("finalize_quiz", finalizeQuizNode);

workflow.addEdge("__start__", "fetch_words");
workflow.addEdge("fetch_words", "pick_article");
workflow.addEdge("pick_article", "scrape_content");
workflow.addEdge("scrape_content", "trigger_worker");
workflow.addEdge("trigger_worker", "check_status");
workflow.addEdge("finalize_quiz", "__end__");

// After Waiting (Resume), Check if content was filled
workflow.addEdge("wait_node", "check_status");

// Conditional Edge Logic for Polling
workflow.addConditionalEdges(
  "check_status",
  (state) => {
    if (state.error) return "finalize_quiz"; // Proceed to end (or error handler)
    if (state.generated_quiz) return "finalize_quiz"; // Done
    return "wait_node"; // Interrupt and cycle back
  },
  {
    finalize_quiz: "finalize_quiz",
    wait_node: "wait_node"
  }
);

const app = workflow.compile({ checkpointer });

// --- HTTP Handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");
    const token = authHeader.replace("Bearer ", "");
    const supabase = supabaseClient(token);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Unauthorized: " + authError);

    const body = await req.json();

    // --- Mode 1: Poll Existing Threads ---
    if (body.thread_ids && Array.isArray(body.thread_ids)) {
      const results = [];

      for (const threadId of body.thread_ids) {
        console.log('here1:', threadId);
        // We only try to resume threads that belong to this user (the threadID convention helps, or Supabase Checkpointer RLS)
        if (!threadId.startsWith(user.id)) {
           results.push({ thread_id: threadId, status: "forbidden" });
           continue;
        }
        console.log('user checks out');

        const config = { configurable: { thread_id: threadId } };

        // Check current state
        const stateSnapshot = await app.getState(config);

        // If graph is finished or error
        if (!stateSnapshot.next || stateSnapshot.next.length === 0) {
          console.log("graph is already finished");
           results.push({
             thread_id: threadId,
             status: "completed",
             result: stateSnapshot.values
           });
           continue;
        }

        // If graph is interrupted (tasks exist), we resume it to Poll the DB again
        if (stateSnapshot.tasks && stateSnapshot.tasks.length > 0) {
          console.log(`Resuming thread ${threadId} to check status...`);

          const result = await app.invoke(new Command({ resume: "poll" }), config);

          // Determine status based on result (is it done now?)
          const finalState = await app.getState(config);
          const isDone = !finalState.next || finalState.next.length === 0;

          results.push({
            thread_id: threadId,
            status: isDone ? "completed" : "processing",
            result: isDone ? finalState.values : null
          });
        }
      }

      return new Response(JSON.stringify({ data: results }), { headers: { "Content-Type": "application/json" } });
    }

    // --- Mode 2: Start New Graph ---
    console.log('starting new graph, body:', body);
    const word_list_ids = body.word_list_ids || [];
    const threadId = `${user.id}-${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };

    const initialState: AgentState = {
      user_token: token,
      user_id: user.id,
      word_list_ids,
      target_words: [],
    };

    // Run until the first interrupt (at check_status)
    console.log('invoking graph');
    await app.invoke(initialState, config);

    // Return the thread_id so the client can poll later
    console.log(`returning thread_id=${threadId} for later polling..`);
    return new Response(JSON.stringify({
      status: "started",
      thread_id: threadId
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
