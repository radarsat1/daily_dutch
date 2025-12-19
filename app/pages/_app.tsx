import '@/styles/globals.css'
import type { AppProps } from 'next/app'
import { AuthProvider } from '@/components/AuthProvider'
import { QuizJobProvider } from "@/components/QuizJobProvider";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <QuizJobProvider>
        <Component {...pageProps} />
      </QuizJobProvider>
    </AuthProvider>
  )
}
