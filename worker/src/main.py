import os
import sqlite3
import random
import json
import httpx
from typing import List, TypedDict, Optional, Annotated
from datetime import datetime
# from bs4 import BeautifulSoup

from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel

from langchain.chat_models import init_chat_model
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.prompt_values import ChatPromptValue

# --- CONFIGURATION ---
# Ensure you have GOOGLE_API_KEY in your environment variables
# os.environ["GOOGLE_API_KEY"] = "AIza..."

# FastAPI app
app = FastAPI(title="Quiz Worker")

# --- Pydantic Models for API ---
from typing import Any
class QuizRequest(BaseModel):
    prompt: dict # ChatPromptValue
    quiz_id: int | None

class QuizQuestion(BaseModel):
    question: str
    answer: str
    english: str

class QuizResponse(BaseModel):
    exercises: list[QuizQuestion]

from fastapi import Request
@app.post('/generate_quiz')
async def generate_quiz(request: QuizRequest):
    """Calls an LLM to generate the quiz exercises."""

    llm = init_chat_model(
        'local-model',
        model_provider='openai',
        base_url="http://localhost:1234/v1",
        api_key="lm-studio"
    ).with_structured_output(QuizResponse)

    try:
        messages = [
            {'role': {'HumanMessage': 'user',
                      'AIMessage': 'chatbot',
                      'SystemMessage': 'system'}[m['id'][-1]],
             'content': m['kwargs']['content']
             }
            for m in request.prompt['kwargs']['messages']
        ]
        result = llm.invoke(messages)
        return result
    except Exception as e:
        print(e)
        return {"error": str(e)}

def save_to_db_node(quiz: QuizResponse):
    """Saves the final result to the business database."""
    if state.get("error") or not state.get("exercises"):
        print(f"Skipping save due to error: {state.get('error')}")
        return {}

    print("--- Step 4: Saving to Database ---")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        json_data = json.dumps(state["exercises"], ensure_ascii=False)
        today = datetime.now().strftime("%Y-%m-%d")

        cursor.execute(
            "INSERT INTO daily_exercises (date, source_url, exercises_json) VALUES (?, ?, ?)",
            (today, state['article_url'], json_data)
        )
        conn.commit()
        conn.close()
        return {"error": None} # Success
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
