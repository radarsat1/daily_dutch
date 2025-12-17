'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Database } from '@/lib/schema'

// Define the shape of the JSON content
interface QuestionItem {
  question: string;
  answer: string; // The correct word
  english: string;
}

// Map the user responses (assuming simple key-value: index -> string)
type UserResponses = Record<string, string>

export default function QuizReview({ quizId, attemptId, onBack }: { quizId: number, attemptId: number, onBack: () => void }) {
  const [questions, setQuestions] = useState<QuestionItem[]>([])
  const [responses, setResponses] = useState<UserResponses>({})
  const [score, setScore] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      // We fetch the Attempt, and join the Quiz to get the original questions
      const { data, error } = await supabase
        .from('quiz_attempts')
        .select(`
          score,
          responses,
          quiz:quizzes (
            content
          )
        `)
        .eq('id', attemptId)
        .single()

      if (error) {
        console.error("Error fetching review:", error)
      }

      if (data) {
        setScore(data.score)
        setResponses((data.responses as UserResponses) || {})

        // Cast the JSON content to our typed array
        // We handle the case where quiz might be null or content might be empty
        const quizContent = data.quiz?.content
        if (Array.isArray(quizContent)) {
          setQuestions(quizContent as QuestionItem[])
        }
      }
      setLoading(false)
    }
    fetchData()
  }, [attemptId])

  if (loading) return (
    <div className="p-12 flex justify-center">
      <div className="animate-pulse text-gray-400">Loading results...</div>
    </div>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button
        onClick={onBack}
        className="mb-6 text-gray-500 hover:text-black flex items-center gap-2 font-medium transition-colors group"
      >
        <span className="group-hover:-translate-x-1 transition-transform">←</span> Back to Quizzes
      </button>

      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Quiz Results</h1>
          <p className="text-gray-500 mt-1">Review your answers below</p>
        </div>
        <div className="text-center">
          <div className="text-sm text-gray-500 uppercase tracking-wide font-semibold">Final Score</div>
          <div className={`text-4xl font-black ${score >= 80 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
            {score}%
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {questions.map((q, idx) => {
          const userAnswer = responses[idx] || ""
          // Simple normalization for comparison
          const isCorrect = userAnswer.trim().toLowerCase() === q.answer.trim().toLowerCase()

          // Split the question text to insert the blank visualization
          // The generator uses "______" (6 underscores) or similar placeholders
          // We split by regex to be safe
          const parts = q.question.split(/_{2,}/)
          const preText = parts[0] || ""
          const postText = parts[1] || ""

          return (
            <div
              key={idx}
              className={`p-6 rounded-lg border-l-4 shadow-sm bg-white transition-all
                ${isCorrect ? 'border-l-green-500' : 'border-l-red-500'}`}
            >
              <div className="mb-3 text-lg leading-relaxed text-gray-800">
                <span className="font-bold text-gray-300 mr-4 select-none">{idx + 1}</span>

                {/* Sentence Construction */}
                <span>{preText}</span>

                {isCorrect ? (
                  <span className="inline-block mx-1 font-bold text-green-700 border-b-2 border-green-200 px-1">
                    {q.answer}
                  </span>
                ) : (
                  <span className="inline-block mx-1">
                    {/* User's Wrong Answer */}
                    <span className="line-through text-red-400 decoration-2 decoration-red-400 mr-2 opacity-75">
                      {userAnswer || '(skipped)'}
                    </span>
                    {/* Correct Answer */}
                    <span className="font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-100">
                      {q.answer}
                    </span>
                  </span>
                )}

                <span>{postText}</span>
              </div>

              {q.english && (
                <div className="flex items-start gap-2 text-gray-500 italic ml-10 text-sm">
                  <span className="select-none opacity-50">EN:</span>
                  <span>{q.english}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
