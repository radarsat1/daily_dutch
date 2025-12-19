import os
import sqlite3
import random
import json
import httpx
from typing import List, TypedDict, Optional, Annotated
from datetime import datetime

from fastapi import FastAPI, BackgroundTasks, Request
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
class QuizRequest(BaseModel):
    prompt: dict # ChatPromptValue
    quiz_id: int
    user_id: str
    webhook: str
    user_token: str

class QuizQuestion(BaseModel):
    question: str
    answer: str
    english: str

class QuizResponse(BaseModel):
    exercises: list[QuizQuestion]

async def process_quiz_generation(request: QuizRequest):
    """
    Background task that calls the LLM and sends the result via webhook.
    """
    print(f"Starting background task for Quiz ID: {request.quiz_id}")

    # Initialize LLM (Note: Ensure this is thread-safe or created per request like here)
    llm = init_chat_model(
        'local-model',
        model_provider='openai',
        base_url="http://localhost:1234/v1",
        api_key="lm-studio"
    ).with_structured_output(QuizResponse)

    try:
        # Reconstruct messages from the raw prompt dictionary
        messages = [
            {'role': {'HumanMessage': 'user',
                      'AIMessage': 'chatbot',
                      'SystemMessage': 'system'}[m['id'][-1]],
             'content': m['kwargs']['content']
             }
            for m in request.prompt['kwargs']['messages']
        ]

        # Invoke LLM
        result = await llm.ainvoke(messages) # Changed to async invoke (ainvoke) for better async performance

        # Send webhook to save the results
        async with httpx.AsyncClient() as client:
            print(f"Quiz {request.quiz_id} generated. Sending webhook...")

            # Extract data safely
            exercises_data = result.model_dump()['exercises'] if hasattr(result, 'model_dump') else result.dict()['exercises']

            response = await client.post(
                request.webhook,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + request.user_token,
                },
                json={
                    'user_id': request.user_id,
                    'quiz_id': request.quiz_id,
                    'questions': exercises_data,
                    'status': 'completed'
                },
                timeout=30.0 # Good practice to have a timeout
            )
            print(f"Webhook response: {response.status_code} - {response.text}")

    except Exception as e:
        print(f"Error processing quiz {request.quiz_id}: {e}")
        # Send error webhook
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    request.webhook,
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + request.user_token,
                    },
                    json={
                        'user_id': request.user_id,
                        'quiz_id': request.quiz_id,
                        'questions': None,
                        'status': 'error',
                        'error_details': str(e)
                    },
                    timeout=30.0
                )
                print(f"Error webhook sent: {response.json()}")
            except Exception as hook_err:
                print(f"Failed to send error webhook: {hook_err}")


@app.post('/generate_quiz')
async def generate_quiz(request: QuizRequest, background_tasks: BackgroundTasks):
    """
    Accepts the request and schedules the generation in the background.
    Returns immediately.
    """
    # Add the heavy lifting to background tasks
    background_tasks.add_task(process_quiz_generation, request)

    # Respond immediately to the caller
    return {
        "status": "processing",
        "message": "Quiz generation started in background.",
        "quiz_id": request.quiz_id
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
