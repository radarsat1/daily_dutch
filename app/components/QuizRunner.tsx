'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { Database } from '@/lib/schema'
import { useAuth } from './AuthProvider'

// Define the content shape
interface QuestionItem {
  question: string;
  answer: string;
  english: string;
}

interface QuizRunnerProps {
  quizId: number
  onFinish: (attemptId: number) => void
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/[^\w\s]/g, '')

export default function QuizRunner({ quizId, onFinish }: QuizRunnerProps) {
  const { user } = useAuth()
  const [questions, setQuestions] = useState<QuestionItem[]>([])
  const [responses, setResponses] = useState<Record<number, string>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const loadQuiz = async () => {
      const { data, error } = await supabase
        .from('quizzes')
        .select('content')
        .eq('id', quizId)
        .single()

      if (data && Array.isArray(data.content)) {
        setQuestions(data.content as QuestionItem[])
      } else {
        console.error("No content found or invalid format", error)
      }
      setLoading(false)
    }

    if (user) loadQuiz()
  }, [quizId, user])

  useEffect(() => {
    if (!loading && inputRef.current) {
      inputRef.current.focus()
    }
  }, [currentIndex, loading])

  // Word Bank Logic
  const allWords = questions.map(q => q.answer).sort()
  const usedWords = Object.values(responses).map(val => normalize(val || ''))

  // Count frequency for duplicate handling
  const usedCounts: Record<string, number> = {}
  usedWords.forEach(w => usedCounts[w] = (usedCounts[w] || 0) + 1)

  const handleNext = () => {
    // 1. Save locally to state
    const val = input.trim()
    if (val) {
      setResponses(prev => ({ ...prev, [currentIndex]: val }))
    }

    // 2. Advance
    setInput('')
    setCurrentIndex(prev => prev + 1)
  }

  const handleFinish = async () => {
    if (!user) return
    setSaving(true)

    // 1. Calculate Score
    let correctCount = 0
    questions.forEach((q, idx) => {
      const userAns = responses[idx] || ""
      if (normalize(userAns) === normalize(q.answer)) {
        correctCount++
      }
    })

    // Guard against division by zero
    const finalScore = questions.length > 0
      ? Math.round((correctCount / questions.length) * 100)
      : 0

    // 2. Save Attempt to DB
    const { data, error } = await supabase
      .from('quiz_attempts')
      .insert({
        user_id: user.id,
        quiz_id: quizId,
        score: finalScore,
        max_score: questions.length, // Optional context
        responses: responses // Save the JSON map
      })
      .select('id')
      .single()

    if (error) {
      console.error("Failed to save attempt:", error)
      alert("Error saving results. Please try again.")
      setSaving(false)
      return
    }

    // 3. Notify Parent
    if (data) onFinish(data.id)
  }

  const jumpTo = (idx: number) => {
    // Allow reviewing previous questions
    if (idx < currentIndex) {
      // Temporarily save current input if active
      if (input.trim()) {
        setResponses(prev => ({ ...prev, [currentIndex]: input.trim() }))
      }

      setCurrentIndex(idx)
      setInput(responses[idx] || '')
    }
  }

  if (loading) return <div className="p-10 text-center text-gray-400">Loading quiz content...</div>

  // --- Completion State ---
  if (currentIndex >= questions.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 animate-in fade-in duration-500">
        <h2 className="text-3xl font-bold mb-4 text-gray-900">Quiz Completed!</h2>
        <p className="mb-8 text-gray-500">You have answered all {questions.length} questions.</p>

        <div className="flex gap-4">
          <button
            onClick={() => jumpTo(questions.length - 1)}
            className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors"
          >
            Review Answers
          </button>
          <button
            onClick={handleFinish}
            disabled={saving}
            className="bg-black text-white px-8 py-3 rounded-lg font-bold hover:bg-gray-800 shadow-lg transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Finish & See Results'}
          </button>
        </div>

        <div className="mt-8 text-sm text-gray-400">
          Answered: {Object.keys(responses).length} / {questions.length}
        </div>
      </div>
    )
  }

  const currentQ = questions[currentIndex]
  // Handle the text splitting for the blank visualization
  // Assuming the generator creates "______" or something similar.
  // We split loosely on 2 or more underscores to catch variants.
  const questionParts = currentQ.question.split(/_{2,}/)

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto p-4">
      {/* Word Bank */}
      <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6 shadow-sm">
        <h3 className="text-xs font-bold uppercase text-gray-400 mb-3 tracking-wide">Word Bank</h3>
        <div className="flex flex-wrap gap-2">
          {allWords.map((w, i) => {
            const norm = normalize(w)
            const isUsed = (usedCounts[norm] || 0) > 0

            // If used, decrement count so duplicates are crossed out one by one
            if (isUsed) usedCounts[norm]--

            return isUsed ? (
              <span key={`${i}-${w}`} className="px-2 py-1 rounded bg-gray-200 text-gray-400 border border-transparent line-through decoration-gray-400 select-none text-sm transition-all">
                {w}
              </span>
            ) : (
              <span key={`${i}-${w}`} className="px-2 py-1 rounded bg-white text-blue-700 border border-blue-200 shadow-sm text-sm font-medium cursor-pointer hover:bg-blue-50 transition-all">
                {w}
              </span>
            )
          })}
        </div>
      </div>

      {/* History / Previous Answers */}
      <div className="flex-1 overflow-y-auto mb-6 space-y-2 pr-2 custom-scrollbar">
        {questions.map((q, idx) => {
          if (idx >= currentIndex) return null // Only show past questions
          const answer = responses[idx]

          return (
            <div
              key={idx}
              onClick={() => jumpTo(idx)}
              className="p-3 rounded-lg bg-white border border-transparent hover:border-gray-200 hover:shadow-sm cursor-pointer transition-all flex items-center justify-between group"
            >
              <div className="text-gray-600 text-sm">
                <span className="text-gray-300 font-mono text-xs mr-3 select-none">{idx + 1}.</span>
                {/* Reconstruct simple preview */}
                {q.question.replace(/_{2,}/g, '___')}
                <span className="text-blue-600 font-bold ml-2 border-b border-blue-200">{answer}</span>
              </div>
              <div className="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 uppercase tracking-wider font-bold bg-gray-100 px-2 py-1 rounded">
                Edit
              </div>
            </div>
          )
        })}
      </div>

      {/* Active Question Card */}
      <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 to-indigo-600"></div>

        <div className="flex justify-between items-center mb-6">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Question {currentIndex + 1} / {questions.length}
          </div>
          {currentQ.english && (
             <div className="text-xs text-gray-400 italic max-w-xs text-right truncate" title={currentQ.english}>
               Hint: {currentQ.english}
             </div>
          )}
        </div>

        <div className="text-2xl md:text-3xl mb-10 leading-snug font-light text-gray-800">
          {questionParts.map((part, i, arr) => (
            <span key={i}>
              {part}
              {i < arr.length - 1 && (
                <span className={`inline-block border-b-2 w-32 mx-2 text-center font-bold transition-all
                  ${input ? 'text-blue-600 border-blue-500' : 'text-gray-300 border-gray-300 animate-pulse'}`}>
                  {input || '?'}
                </span>
              )}
            </span>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleNext(); }} className="flex gap-4">
          <input
            ref={inputRef}
            className="flex-1 px-4 py-4 border border-gray-200 bg-gray-50 rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50/50 outline-none text-xl transition-all placeholder-gray-400"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type the missing word..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="bg-blue-600 text-white px-8 py-4 rounded-xl font-bold hover:bg-blue-700 active:transform active:scale-95 transition-all shadow-lg hover:shadow-blue-200 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
          >
            Next
          </button>
        </form>
      </div>
    </div>
  )
}
