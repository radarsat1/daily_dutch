'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Database } from '@/lib/schema'
import { useQuizJob } from "@/components/QuizJobProvider";

// Update Type Definition based on Hybrid Schema
type QuizRow = Database['public']['Tables']['quizzes']['Row']
type QuizAttempt = Database['public']['Tables']['quiz_attempts']['Row']

// Composite type for the view
type QuizWithHistory = QuizRow & {
  quiz_attempts: Pick<QuizAttempt, 'id' | 'score' | 'created_at'>[]
}

interface QuizListProps {
  // onSelectQuiz now passes the quizId and optionally an attemptId (if reviewing history)
  onSelectQuiz: (id: number, attemptId?: number) => void
}

export default function QuizList({ onSelectQuiz }: QuizListProps) {
  const [quizzes, setQuizzes] = useState<QuizWithHistory[]>([])
  const [wordLists, setWordLists] = useState<{id: number, name: string}[]>([])
  const [selectedLists, setSelectedLists] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const { trackJob } = useQuizJob();

  const fetchQuizzes = async () => {
    // 1. Fetch Quizzes with their Attempts (History)
    // Note: We use quiz_attempts instead of quiz_sessions now
    const { data, error } = await supabase
      .from('quizzes')
      .select('*, quiz_attempts(id, score, created_at)')
      .order('created_at', { ascending: false })

    if (error) console.error('Error fetching quizzes:', error)
    if (data) setQuizzes(data as any) // Cast due to joined array structure

    setLoading(false)

    // 2. Fetch Word Lists for the Generator UI
    const { data: lists } = await supabase
      .from('word_lists')
      .select('id, name')
      .order('name')

    if (lists) setWordLists(lists)
  }

  const toggleList = (id: number) => {
    if (selectedLists.includes(id)) setSelectedLists(selectedLists.filter(x => x !== id))
    else setSelectedLists([...selectedLists, id])
  }

  useEffect(() => {
    fetchQuizzes()
  }, [])

  const handleGenerateQuiz = async () => {
    setGenerating(true)

    try {
      // Get current session for the JWT
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      // Call the Edge Function
      // The function now handles fetching words, scraping, and DB insertion internally
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { word_list_ids: selectedLists }
      })

      if (error) {
        throw new Error(err.error || 'Failed to generate quiz')
      }

      // Hand off the thread_id to the global poller
      trackJob(data.thread_id);

      // Refresh the list to show the new quiz
      await fetchQuizzes()

      // Optional: Clear selection
      setSelectedLists([])

    } catch (e: any) {
      console.error('Generation failed:', e)
      // TODO: replace with toast pop-up
      //alert('Failed to generate quiz: ' + e.message)
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <div>Loading quizzes...</div>

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Quizzes</h2>

        {/* Generator Controls */}
        <div className="flex gap-4 items-center">
          <div className="flex gap-2">
            {wordLists.map(l => (
              <label key={l.id} className="flex items-center space-x-1 text-sm bg-gray-100 px-2 py-1 rounded cursor-pointer select-none hover:bg-gray-200 transition-colors">
                <input
                  type="checkbox"
                  checked={selectedLists.includes(l.id)}
                  onChange={() => toggleList(l.id)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span>{l.name}</span>
              </label>
            ))}
          </div>
          <button
            onClick={handleGenerateQuiz}
            disabled={generating}
            className={`px-4 py-2 rounded shadow font-medium transition-colors text-white
              ${generating ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {generating ? 'AI Generating...' : 'Generate New Quiz'}
          </button>
        </div>
      </div>

      {/* Quiz Grid */}
      <div className="grid gap-4">
        {quizzes.map((quiz) => {
          // Sort attempts by newest first
          const attempts = quiz.quiz_attempts?.sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          ) || []

          return (
            <div
              key={quiz.id}
              className="bg-white p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow border border-gray-200"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-xl text-gray-900 mb-1">
                    {quiz?.context?.title ?? 'Untitled Quiz'}
                  </h3>

                  <div className="flex gap-2 text-sm text-gray-500 mb-2">
                    <span>{new Date(quiz.created_at).toLocaleDateString()}</span>
                    <span>•</span>
                    <span className="capitalize">{quiz.source_type || 'Article'}</span>
                  </div>

                  {/* Status Indicator (if generating happens async in background) */}
                  {quiz.status !== 'ready' && (
                     <span className="inline-block px-2 py-0.5 text-xs rounded bg-yellow-100 text-yellow-800 mb-2">
                       {quiz.status}
                     </span>
                  )}

                  {/* History / Attempts */}
                  {attempts.length > 0 && (
                    <div className="mt-4">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        History
                      </span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {attempts.map(attempt => (
                          <button
                            key={attempt.id}
                            onClick={() => onSelectQuiz(quiz.id, attempt.id)}
                            className={`text-xs px-2 py-1 rounded border transition-colors
                              ${attempt.score >= 80
                                ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                                : 'bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100'
                              }`}
                          >
                            {Math.round(attempt.score)}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => onSelectQuiz(quiz.id)}
                  className="text-sm border border-gray-300 px-3 py-1 rounded hover:bg-gray-50 text-gray-700 transition-colors"
                >
                  Start New
                </button>
              </div>
            </div>
          )
        })}

        {quizzes.length === 0 && !loading && (
          <div className="text-center py-10 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            No quizzes found. Select a word list and generate one!
          </div>
        )}
      </div>
    </div>
  )
}
