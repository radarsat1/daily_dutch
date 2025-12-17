import { createClient } from "@supabase/supabase-js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { EdgeOpenAI } from "./EdgeOpenAI.ts";
import { StateGraph } from "@langchain/langgraph";
import { SupabaseSaver } from "./SupabaseSaver.ts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import * as cheerio from "cheerio";
import { z } from "zod";

// --- Config ---
const NUM_SENTENCES = 10;

// Helper to get an LLM.
function getLLM() {
  const provider = (Deno.env.get("LLM_PROVIDER") || "google").toLowerCase();
  const modelName = Deno.env.get("LLM_MODEL") || "gemini-2.5-flash";
  const temperature = 0.7;

  console.log(`Initializing LLM: ${provider} (${modelName})`);

  // 1. Google Gemini
  if (provider.includes("google") || provider.includes("gemini")) {
    return new ChatGoogleGenerativeAI({
      model: modelName,
      temperature,
      apiKey: Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("LLM_API_KEY"),
    });
  }

  // 2. OpenAI / OpenRouter / Local
  // These all share the OpenAI API signature
  const apiKey = Deno.env.get("LLM_API_KEY") || "dummy-key";
  let baseUrl = Deno.env.get("LLM_BASE_URL");

  // Auto-configure URL defaults if not provided
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

// Version of the above for structured output
const QuizSchema = z.array(z.object({
  question: z.string().describe("The Dutch sentence"),
  answer: z.string().describe("The missing Dutch word"),
  english: z.string().describe("The English translation"),
}));

interface AgentState {
  // Inputs
  user_token: string; // Passed to allow RLS-compliant DB calls inside nodes
  user_id: string;
  word_list_ids: number[];

  // Pipeline Data
  target_words: string[];
  article_url?: string;
  article_title?: string;
  article_text?: string;

  // Output
  generated_quiz?: QuizQuestion[];
  quiz_id?: number;
  error?: string;
}

// --- Node Functions ---

async function fetchWordsNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error) {
    console.log(state.error);
    return {};
  }
  console.log("--- Step 1: Fetching Target Words ---");

  // Use User Token to respect RLS
  const supabase = supabaseClient(state.user_token);

  if (!state.word_list_ids || state.word_list_ids.length === 0) {
    return { target_words: ["nieuws", "vandaag", "belangrijk"] };
  }

  // Fetch from the JSONB 'words' column
  const { data, error } = await supabase
    .from("word_lists")
    .select("words")
    .in("id", state.word_list_ids);

  if (error) return { error: `DB Error: ${error.message}` };

  // Flatten the arrays: data is [{ words: ["a", "b"] }, { words: ["c"] }]
  const allWords: string[] = data.flatMap((row: any) => row.words || []);

  // Dedup
  const uniqueWords = [...new Set(allWords)];

  return { target_words: uniqueWords.length > 0 ? uniqueWords : ["general"] };
}

async function pickArticleNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error) {
    console.log(state.error);
    return {};
  }
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

    const uniqueLinks = [...new Set(links)];
    const selectedPath = uniqueLinks[Math.floor(Math.random() * uniqueLinks.length)];
    const fullUrl = `https://nos.nl${selectedPath}`;

    return { article_url: fullUrl };
  } catch (e: any) {
    return { error: e.message };
  }
}

async function scrapeContentNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error || !state.article_url) {
    console.log(state.error);
    return {};
  }
  console.log(`--- Step 3: Scraping ${state.article_url} ---`);

  try {
    const response = await fetch(state.article_url);
    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $("title").text().replace(" | NOS", "").trim();

    let paragraphs = $("article p");
    if (paragraphs.length === 0) paragraphs = $("p");

    const textParts: string[] = [];
    paragraphs.each((_, el) => {
      textParts.push($(el).text());
    });

    return {
      article_text: textParts.join(" ").slice(0, 8000),
      article_title: title
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

async function generateQuizNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error || !state.article_url) {
    console.log(state.error);
    return {};
  }
  console.log("--- Step 4: Generating Quiz (Gemini) ---");

  const llm = getLLM().withStructuredOutput(QuizSchema);

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
      {{"sentence": "Het schrijven van een brief is een lastige klus.", "answer": "klus", "english", "Writing a letter is a difficult task."}},
      ...
    ]
  `;

  const prompt = ChatPromptTemplate.fromTemplate(promptText);
  const chain = prompt.pipe(llm);

  try {
    const result = await chain.invoke({
      article_text: state.article_text,
      target_words: state.target_words.join(", "),
      num_sentences: NUM_SENTENCES,
      subset_sentences: parseInt(NUM_SENTENCES*3/4),
    });
    return { generated_quiz: result as QuizQuestion[] };
  } catch (e: any) {
    return { error: e.message };
  }
}

async function saveToDbNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.error || !state.article_url) {
    console.log(state.error);
    return {};
  }
  console.log("--- Step 5: Saving to DB ---");

  // Re-initialize client with user token for RLS
  const supabase = supabaseClient(state.user_token);

  // 1. Insert Quiz (Content is JSONB)
  const { data: quiz, error: quizError } = await supabase
    .from("quizzes")
    .insert({
      user_id: state.user_id, // RLS will also check auth.uid()
      context: {
        title: state.article_title,
        url: state.article_url,
        type: 'article'
      },
      content: state.generated_quiz,
      status: "ready"
    })
    .select("id")
    .single();

  if (quizError) console.log(quizError);
  if (quizError) return { error: quizError.message };

  // 2. Link Word Lists (Optional)
  if (state.word_list_ids && state.word_list_ids.length > 0) {
    const links = state.word_list_ids.map(id => ({
      quiz_id: quiz.id,
      word_list_id: id
    }));
    await supabase.from("quiz_word_lists").insert(links);
  }

  return { quiz_id: quiz.id };
}

// --- Graph Setup ---
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);
const checkpointer = new SupabaseSaver(supabase);

function supabaseClient(user_token) {
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${user_token}` } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

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
workflow.addNode("generate_quiz", generateQuizNode);
workflow.addNode("save_to_db", saveToDbNode);

workflow.addEdge("__start__", "fetch_words");
workflow.addEdge("fetch_words", "pick_article");
workflow.addEdge("pick_article", "scrape_content");
workflow.addEdge("scrape_content", "generate_quiz");
workflow.addEdge("generate_quiz", "save_to_db");
workflow.addEdge("save_to_db", "__end__");

const app = workflow.compile({ checkpointer });

// --- Server ---
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    // Extract just the token string (remove "Bearer ")
    const token = authHeader.replace("Bearer ", "");

    // We pass the auth header globally so RLS policies in the DB work automatically.
    const supabase = supabaseClient(token);

    // 4. Validate User Explicitly
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Unauthorized: " + authError);

    const body = await req.json();
    const word_list_ids = body.word_list_ids || [];

    // Thread ID tied to User
    const threadId = `${user.id}-${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };

    const initialState: AgentState = {
      user_token: token,
      user_id: user.id,
      word_list_ids,
      target_words: [],
    };

    const result = await app.invoke(initialState, config);

    return new Response(JSON.stringify({
      status: "success",
      run_id: threadId,
      data: result
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
