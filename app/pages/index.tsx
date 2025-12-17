import Head from 'next/head'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/utils/supabase'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { useAuth } from '@/components/AuthProvider'
import Sidebar from '@/components/Sidebar'
import WordListEditor from '@/components/WordListEditor'
import QuizList from '@/components/QuizList'
import QuizRunner from '@/components/QuizRunner'
import QuizReview from '@/components/QuizReview'

// Dynamic import for Auth to avoid SSR issues with Supabase Auth UI
const Auth = dynamic(
  () => import('@supabase/auth-ui-react').then((mod) => mod.Auth),
  { ssr: false }
)

export default function Home() {
  const { user, loading } = useAuth()

  // Navigation State
  const [view, setView] = useState('quizzes') // 'wordlists' | 'quizzes'

  // Quiz Flow State
  const [activeQuizId, setActiveQuizId] = useState<number | null>(null)
  const [activeAttemptId, setActiveAttemptId] = useState<number | null>(null)
  const [isReviewing, setIsReviewing] = useState(false)

  const resetQuizState = () => {
    setActiveQuizId(null)
    setActiveAttemptId(null)
    setIsReviewing(false)
  }

  return (
    <>
      <Head>
        <title>Daily Dutch</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="w-full h-screen bg-white overflow-hidden">
        {(!user || loading) ? (
          <div className="min-w-full min-h-screen flex items-center justify-center bg-gray-50">
            <div className="w-full h-full flex justify-center items-center p-4">
              <div className="w-full h-full sm:h-auto sm:w-96 max-w-md p-8 bg-white shadow-lg rounded-xl flex flex-col border border-gray-100">
                <h1 className="font-sans text-3xl font-bold text-center mb-2 text-gray-900">
                  Daily Dutch
                </h1>
                <p className="text-center text-gray-500 mb-6 text-sm">Sign in to start learning</p>
                <Auth
                  supabaseClient={supabase}
                  appearance={{
                    theme: ThemeSupa,
                    variables: {
                      default: {
                        colors: {
                          brand: '#2563eb',
                          brandAccent: '#1d4ed8',
                        }
                      }
                    }
                  }}
                  theme="light"
                  providers={[]} // Add 'google' or 'github' here if enabled
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full">
            <Sidebar
              currentView={view}
              onChangeView={(v) => {
                setView(v)
                resetQuizState()
              }}
            />

            <main className="flex-1 h-full overflow-hidden bg-gray-50">
              {/* VIEW: WORD LISTS */}
              {view === 'wordlists' && <WordListEditor />}

              {/* VIEW: QUIZZES DASHBOARD */}
              {view === 'quizzes' && !activeQuizId && (
                <QuizList
                  onSelectQuiz={(id, attemptId) => {
                    setActiveQuizId(id)
                    if (attemptId) {
                      // Resume/Review existing attempt
                      setActiveAttemptId(attemptId)
                      setIsReviewing(true)
                    } else {
                      // Start New
                      setActiveAttemptId(null)
                      setIsReviewing(false)
                    }
                  }}
                />
              )}

              {/* VIEW: QUIZ REVIEW (History) */}
              {view === 'quizzes' && activeQuizId && isReviewing && activeAttemptId && (
                <QuizReview
                  quizId={activeQuizId}
                  attemptId={activeAttemptId}
                  onBack={resetQuizState}
                />
              )}

              {/* VIEW: QUIZ RUNNER (Active) */}
              {view === 'quizzes' && activeQuizId && !isReviewing && (
                <QuizRunner
                  quizId={activeQuizId}
                  onFinish={(newAttemptId) => {
                    setActiveAttemptId(newAttemptId)
                    setIsReviewing(true)
                  }}
                />
              )}
            </main>
          </div>
        )}
      </div>
    </>
  )
}
