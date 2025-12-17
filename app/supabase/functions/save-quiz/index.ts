import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST" && req.method !== "PUT") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    // Extract just the token string (remove "Bearer ")
    const token = authHeader.replace("Bearer ", "");

    // 3. Initialize Client WITHOUT Session Persistence
    // We pass the auth header globally so RLS policies in the DB work automatically.
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    // 4. Validate User Explicitly
    // Pass the token directly to getUser. This fixes 'AuthSessionMissingError'.
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid Token", details: authError }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const payload = await req.json();

    // Payload expected: { title: "...", questions: [...], word_list_ids: [] }
    if (!payload.questions || !Array.isArray(payload.questions)) {
      throw new Error("Invalid payload: 'questions' must be an array.");
    }

    // 1. Insert Quiz (Questions go into 'content' JSONB column)
    const { data: quiz, error: quizError } = await supabase
      .from("quizzes")
      .insert({
        user_id: user.id,
        context: payload.context,
        content: payload.questions, // Direct JSON save
        status: "ready"
      })
      .select()
      .single();

    if (quizError) throw quizError;

    // 2. Link Word Lists (Optional)
    if (payload.word_list_ids && Array.isArray(payload.word_list_ids)) {
      const links = payload.word_list_ids.map((id: number) => ({
        quiz_id: quiz.id,
        word_list_id: id,
      }));
      await supabase.from("quiz_word_lists").insert(links);
    }

    return new Response(
      JSON.stringify({ message: "Quiz saved", quiz_id: quiz.id }),
      {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        status: 200
      }
    );

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
